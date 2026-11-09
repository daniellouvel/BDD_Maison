"""Étiquettes QR universelles : codes, affectation, remplacement, désactivation, historique."""

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models import Node, PrintSheet, QrEvent, QrLabel, User, utcnow
from app.schemas import LabelEventOut, LabelOut, QrStats
from app.services import nodes as node_service
from app.services.common import get_active

CODE_RE = re.compile(r"QR-?(\d{1,6})(?!\d)", re.IGNORECASE)


def format_code(seq: int) -> str:
    return f"QR-{seq:06d}"


def parse_code(raw: str) -> str:
    """Accepte « QR-000001 », « qr-1 » ou une URL https://…/l/QR-000001."""
    match = CODE_RE.search(raw or "")
    if not match or int(match.group(1)) == 0:
        raise ApiError(422, "invalid_code", "Ce n'est pas une étiquette MyWorkshop (format QR-000001).")
    return format_code(int(match.group(1)))


def payload(code: str) -> str:
    """Texte encodé dans le QR."""
    base = get_settings().qr_public_url.rstrip("/")
    return f"{base}/l/{code}" if base else code


def get_label(db: Session, code: str, *, lock: bool = False) -> QrLabel:
    stmt = select(QrLabel).where(QrLabel.code == code)
    if lock:
        stmt = stmt.with_for_update()
    label = db.scalar(stmt)
    if label is None:
        raise ApiError(
            404,
            "unknown_label",
            f"Étiquette {code} inconnue : elle n'a jamais été imprimée par MyWorkshop.",
        )
    return label


def label_for_node(db: Session, node_id: uuid.UUID) -> QrLabel | None:
    return db.scalar(select(QrLabel).where(QrLabel.assigned_node_id == node_id))


def record(
    db: Session,
    label: QrLabel,
    event: str,
    actor: User | None,
    *,
    node_id: uuid.UUID | None = None,
    sheet_id: uuid.UUID | None = None,
    detail: str | None = None,
) -> None:
    db.add(
        QrEvent(
            code=label.code,
            event=event,
            node_id=node_id,
            sheet_id=sheet_id,
            detail=detail,
            actor_id=actor.id if actor else None,
            at=utcnow(),
        )
    )


def _node_name(db: Session, node_id: uuid.UUID | None) -> str:
    node = db.get(Node, node_id) if node_id else None
    return node_service.label(db, node) if node else "un élément"


def assign(db: Session, code: str, node_id: uuid.UUID, actor: User) -> QrLabel:
    label = get_label(db, code, lock=True)
    node = get_active(db, Node, node_id, "Élément")
    if label.status == "assigned":
        if label.assigned_node_id == node.id:
            return label  # déjà fait : rejouer l'opération ne change rien
        raise ApiError(
            409,
            "label_assigned",
            f"L'étiquette {code} est déjà affectée à « {_node_name(db, label.assigned_node_id)} ».",
        )
    if label.status == "disabled":
        raise ApiError(
            409,
            "label_disabled",
            f"L'étiquette {code} est désactivée ({label.disabled_reason or 'sans motif'}).",
        )
    existing = label_for_node(db, node.id)
    if existing is not None:
        raise ApiError(
            409,
            "node_has_label",
            f"Cet élément porte déjà l'étiquette {existing.code}. Utilisez « Remplacer ».",
        )
    label.status = "assigned"
    label.assigned_node_id = node.id
    label.updated_at = utcnow()
    record(db, label, "assigned", actor, node_id=node.id)
    db.commit()
    return label


def disable(db: Session, code: str, reason: str, actor: User) -> QrLabel:
    label = get_label(db, code, lock=True)
    if label.status == "disabled":
        raise ApiError(409, "label_disabled", f"L'étiquette {code} est déjà désactivée.")
    node_id = label.assigned_node_id
    label.status = "disabled"
    label.assigned_node_id = None
    label.disabled_reason = reason
    label.updated_at = utcnow()
    record(db, label, "disabled", actor, node_id=node_id, detail=reason)
    db.commit()
    return label


def replace(db: Session, old_code: str, new_code: str, actor: User) -> QrLabel:
    """L'ancienne étiquette (abîmée, perdue) est désactivée ; la nouvelle prend sa place."""
    if old_code == new_code:
        raise ApiError(422, "same_label", "Choisissez une autre étiquette.")
    old = get_label(db, old_code, lock=True)
    new = get_label(db, new_code, lock=True)
    if old.status != "assigned" or old.assigned_node_id is None:
        raise ApiError(409, "label_not_assigned", f"L'étiquette {old_code} n'est affectée à rien.")
    if new.status != "available":
        raise ApiError(409, "label_not_available", f"L'étiquette {new_code} n'est pas disponible.")
    node_id = old.assigned_node_id

    old.status = "disabled"
    old.assigned_node_id = None
    old.disabled_reason = f"Remplacée par {new_code}"
    old.updated_at = utcnow()
    db.flush()  # libère l'unicité de assigned_node_id avant la nouvelle affectation

    new.status = "assigned"
    new.assigned_node_id = node_id
    new.updated_at = utcnow()
    record(db, old, "replaced", actor, node_id=node_id, detail=f"Remplacée par {new_code}")
    record(db, new, "assigned", actor, node_id=node_id, detail=f"Remplace {old_code}")
    db.commit()
    return new


def reactivate(db: Session, code: str, actor: User) -> QrLabel:
    label = get_label(db, code, lock=True)
    if label.status != "disabled":
        raise ApiError(409, "label_not_disabled", f"L'étiquette {code} n'est pas désactivée.")
    label.status = "available"
    label.disabled_reason = None
    label.updated_at = utcnow()
    record(db, label, "reactivated", actor)
    db.commit()
    return label


def describe(db: Session, label: QrLabel) -> LabelOut:
    node = db.get(Node, label.assigned_node_id) if label.assigned_node_id else None
    events = db.scalars(
        select(QrEvent).where(QrEvent.code == label.code).order_by(QrEvent.at, QrEvent.id)
    ).all()
    return LabelOut(
        code=label.code,
        seq=label.seq,
        status=label.status,
        disabled_reason=label.disabled_reason,
        print_count=label.print_count,
        printed_at=label.printed_at,
        payload=payload(label.code),
        node=node_service.detail(db, node) if node else None,
        events=[LabelEventOut.model_validate(e) for e in events],
    )


def count_by_status(db: Session) -> dict[str, int]:
    rows = db.execute(select(QrLabel.status, func.count()).group_by(QrLabel.status)).all()
    counts = {"available": 0, "assigned": 0, "disabled": 0}
    counts.update({status: int(n) for status, n in rows})
    return counts


def stats(db: Session) -> QrStats:
    counts = count_by_status(db)
    max_seq = db.scalar(select(func.max(QrLabel.seq))) or 0
    return QrStats(
        **counts,
        total=sum(counts.values()),
        next_code=format_code(max_seq + 1),
        sheets=int(db.scalar(select(func.count()).select_from(PrintSheet)) or 0),
        public_url=get_settings().qr_public_url,
    )
