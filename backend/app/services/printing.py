"""Planches d'étiquettes : allocation des codes, protection contre les doublons, rendu PDF."""

import io
import uuid
from collections.abc import Iterable

import segno
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import AppSetting, PrintItem, PrintSheet, QrLabel, User, utcnow
from app.schemas import PT_TO_MM, LabelConflict, LabelLayout, SheetOut, SheetPreview, SheetRequest
from app.services import qr as qr_service

LAYOUT_KEY = "label_layout"
SHEET_LOCK_KEY = 7_420_001  # verrou consultatif : une seule création de planche à la fois
QUIET_ZONE_MODULES = 2


# --- Gabarit ------------------------------------------------------------------------------------


def get_layout(db: Session) -> LabelLayout:
    setting = db.get(AppSetting, LAYOUT_KEY)
    return LabelLayout(**setting.value) if setting else LabelLayout()


def set_layout(db: Session, layout: LabelLayout) -> LabelLayout:
    setting = db.get(AppSetting, LAYOUT_KEY)
    if setting is None:
        db.add(AppSetting(key=LAYOUT_KEY, value=layout.model_dump()))
    else:
        setting.value = layout.model_dump()
    db.commit()
    return layout


# --- Planification et création ------------------------------------------------------------------


def _plan(db: Session, req: SheetRequest, layout: LabelLayout) -> tuple[list[str], list[QrLabel]]:
    capacity = layout.capacity
    if req.start_position > capacity:
        raise ApiError(422, "invalid_position", f"La planche ne compte que {capacity} étiquettes.")
    free_slots = capacity - req.start_position + 1
    count = req.count or free_slots
    if count > free_slots:
        raise ApiError(
            422,
            "too_many_labels",
            f"Seulement {free_slots} emplacements libres à partir de la position {req.start_position}.",
        )

    if req.mode == "next":
        max_seq = db.scalar(select(func.max(QrLabel.seq))) or 0
        seqs = range(max_seq + 1, max_seq + 1 + count)
    else:
        if req.start_seq is None:
            raise ApiError(422, "start_required", "Indiquez le premier code à réimprimer.")
        seqs = range(req.start_seq, req.start_seq + count)

    codes = [qr_service.format_code(s) for s in seqs]
    existing = list(db.scalars(select(QrLabel).where(QrLabel.code.in_(codes)).order_by(QrLabel.seq)))

    if req.mode == "range":
        known = {label.code for label in existing}
        missing = [c for c in codes if c not in known]
        if missing:
            raise ApiError(
                422,
                "unknown_codes",
                f"Jamais imprimés : {', '.join(missing[:5])}{'…' if len(missing) > 5 else ''}. "
                "Les nouveaux codes s'obtiennent avec « Nouvelle planche ».",
            )
    return codes, existing


def _conflicts(labels: Iterable[QrLabel]) -> list[LabelConflict]:
    return [
        LabelConflict(
            code=label.code,
            status=label.status,
            print_count=label.print_count,
            printed_at=label.printed_at,
        )
        for label in labels
        if label.print_count > 0
    ]


def preview(db: Session, req: SheetRequest) -> SheetPreview:
    layout = get_layout(db)
    codes, existing = _plan(db, req, layout)
    conflicts = _conflicts(existing)
    return SheetPreview(
        codes=codes,
        start_position=req.start_position,
        capacity=layout.capacity,
        already_printed=conflicts,
        requires_confirmation=bool(conflicts),
    )


def create_sheet(db: Session, req: SheetRequest, actor: User) -> PrintSheet:
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SHEET_LOCK_KEY})
    layout = get_layout(db)
    codes, existing = _plan(db, req, layout)
    conflicts = _conflicts(existing)
    if conflicts and not req.confirm_reprint:
        raise ApiError(
            409,
            "reprint_confirmation_required",
            f"{len(conflicts)} code(s) déjà imprimé(s), de {conflicts[0].code} à {conflicts[-1].code}. "
            "Confirmez explicitement la réimpression.",
        )

    now = utcnow()
    sheet = PrintSheet(
        is_reprint=bool(conflicts),
        start_position=req.start_position,
        label_count=len(codes),
        layout=layout.model_dump(),
        created_by=actor.id,
        created_at=now,
    )
    db.add(sheet)
    db.flush()

    by_code = {label.code: label for label in existing}
    for offset, code in enumerate(codes):
        label = by_code.get(code)
        reprint = label is not None and label.print_count > 0
        if label is None:
            label = QrLabel(
                code=code,
                seq=int(code[3:]),
                status="available",
                print_count=0,
                created_at=now,
                updated_at=now,
            )
            db.add(label)
            db.flush()
            qr_service.record(db, label, "created", actor, sheet_id=sheet.id)
        label.print_count += 1
        label.printed_at = label.printed_at or now
        label.updated_at = now
        db.add(PrintItem(sheet_id=sheet.id, position=req.start_position + offset, code=code, is_reprint=reprint))
        qr_service.record(
            db,
            label,
            "reprinted" if reprint else "printed",
            actor,
            sheet_id=sheet.id,
            detail=f"Planche n° {sheet.number}, position {req.start_position + offset}",
        )
    db.commit()
    db.refresh(sheet)
    return sheet


def sheet_out(db: Session, sheet: PrintSheet) -> SheetOut:
    first, last = db.execute(
        select(func.min(PrintItem.code), func.max(PrintItem.code)).where(PrintItem.sheet_id == sheet.id)
    ).one()
    out = SheetOut.model_validate(sheet)
    out.first_code, out.last_code = first, last
    return out


def list_sheets(db: Session, limit: int = 50) -> list[SheetOut]:
    sheets = db.scalars(select(PrintSheet).order_by(PrintSheet.number.desc()).limit(limit))
    return [sheet_out(db, s) for s in sheets]


def sheet_pdf(db: Session, sheet_id: uuid.UUID) -> tuple[PrintSheet, bytes]:
    sheet = db.get(PrintSheet, sheet_id)
    if sheet is None:
        raise ApiError(404, "not_found", "Planche introuvable")
    items = db.execute(
        select(PrintItem.position, PrintItem.code)
        .where(PrintItem.sheet_id == sheet.id)
        .order_by(PrintItem.position)
    ).all()
    layout = LabelLayout(**sheet.layout)
    labels = [(pos, code, qr_service.payload(code)) for pos, code in items]
    return sheet, render_pdf(layout, labels, title=f"MyWorkshop - planche {sheet.number}")


def test_sheet_pdf(db: Session) -> bytes:
    """Planche d'essai pour calibrer l'imprimante : bordures + faux codes, rien n'est enregistré."""
    layout = get_layout(db).model_copy(update={"draw_borders": True})
    labels = [(p, f"ESSAI {p:02d}", f"ESSAI-{p:02d}") for p in range(1, layout.capacity + 1)]
    return render_pdf(layout, labels, title="MyWorkshop - planche d'essai")


# --- Rendu PDF ----------------------------------------------------------------------------------


def render_pdf(layout: LabelLayout, labels: list[tuple[int, str, str]], title: str) -> bytes:
    """labels : (position 1..capacité, texte lisible, contenu du QR)."""
    buffer = io.BytesIO()
    page_h = layout.page_height
    pdf = canvas.Canvas(buffer, pagesize=(layout.page_width * mm, page_h * mm))
    pdf.setTitle(title)
    pdf.setAuthor("MyWorkshop")

    for position, caption, content in labels:
        index = position - 1
        col, row = index % layout.columns, index // layout.columns
        left = layout.margin_left + col * layout.pitch_x
        top = layout.margin_top + row * layout.pitch_y  # depuis le haut de la page

        if layout.draw_borders:
            pdf.setLineWidth(0.2)
            pdf.rect(left * mm, (page_h - top - layout.label_height) * mm,
                     layout.label_width * mm, layout.label_height * mm)

        # QR code à gauche, texte à droite, centrés verticalement (comme dans Kept).
        pad = min(1.5, (layout.label_width - layout.qr_size) / 4)
        qr_left = left + pad
        qr_top = top + (layout.label_height - layout.qr_size) / 2
        _draw_qr(pdf, content, qr_left, qr_top, layout.qr_size, page_h)

        text_left = qr_left + layout.qr_size + pad
        text_width = layout.label_width - (text_left - left) - pad
        size = layout.font_size
        while size > 4 and pdf.stringWidth(caption, "Helvetica-Bold", size) > text_width * mm:
            size -= 0.5
        pdf.setFont("Helvetica-Bold", size)
        baseline = top + layout.label_height / 2 + (size * PT_TO_MM) * 0.35
        pdf.drawString(text_left * mm, (page_h - baseline) * mm, caption)

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _draw_qr(pdf: canvas.Canvas, content: str, left: float, top: float, size: float, page_h: float) -> None:
    """Dessine le QR en vectoriel (rectangles), marge blanche de 2 modules comprise dans `size`."""
    matrix = [list(row) for row in segno.make(content, error="m", micro=False).matrix]
    n = len(matrix)
    module = size / (n + 2 * QUIET_ZONE_MODULES)
    origin_x = left + QUIET_ZONE_MODULES * module
    origin_y = top + QUIET_ZONE_MODULES * module
    pdf.setFillColorRGB(0, 0, 0)
    for r, row in enumerate(matrix):
        c = 0
        while c < n:
            if not row[c]:
                c += 1
                continue
            start = c
            while c < n and row[c]:
                c += 1
            x = origin_x + start * module
            y_top = origin_y + r * module
            # recouvrement de 0,25 pt vers le haut : évite les liserés blancs entre rangées
            pdf.rect(x * mm, (page_h - y_top - module) * mm, (c - start) * module * mm,
                     module * mm + 0.25, stroke=0, fill=1)
