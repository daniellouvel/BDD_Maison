import uuid

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.api.deps import Admin, CurrentUser, DbSession, Writer
from app.schemas import (
    AssignIn,
    DisableIn,
    LabelLayout,
    LabelOut,
    QrStats,
    ReplaceIn,
    SheetOut,
    SheetPreview,
    SheetRequest,
)
from app.services import printing
from app.services import qr as qr_service

router = APIRouter(prefix="/qr", tags=["étiquettes QR"])


def _pdf(content: bytes, filename: str) -> Response:
    return Response(
        content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.get("/stats", response_model=QrStats)
def stats(db: DbSession, _: CurrentUser) -> QrStats:
    return qr_service.stats(db)


@router.get("/layout", response_model=LabelLayout)
def get_layout(db: DbSession, _: CurrentUser) -> LabelLayout:
    return printing.get_layout(db)


@router.put("/layout", response_model=LabelLayout)
def put_layout(body: LabelLayout, db: DbSession, _: Writer) -> LabelLayout:
    return printing.set_layout(db, body)


@router.get("/layout/test.pdf")
def layout_test(db: DbSession, _: CurrentUser) -> Response:
    return _pdf(printing.test_sheet_pdf(db), "planche-essai.pdf")


@router.post("/sheets/preview", response_model=SheetPreview)
def preview_sheet(body: SheetRequest, db: DbSession, _: Writer) -> SheetPreview:
    return printing.preview(db, body)


@router.post("/sheets", response_model=SheetOut, status_code=201)
def create_sheet(body: SheetRequest, db: DbSession, user: Writer) -> SheetOut:
    sheet = printing.create_sheet(db, body, user)
    return printing.sheet_out(db, sheet)


@router.get("/sheets", response_model=list[SheetOut])
def list_sheets(
    db: DbSession, _: CurrentUser, limit: int = Query(default=50, ge=1, le=500)
) -> list[SheetOut]:
    return printing.list_sheets(db, limit)


@router.get("/sheets/{sheet_id}/pdf")
def sheet_pdf(sheet_id: uuid.UUID, db: DbSession, _: CurrentUser) -> Response:
    sheet, content = printing.sheet_pdf(db, sheet_id)
    return _pdf(content, f"planche-{sheet.number:04d}.pdf")


@router.get("/labels/{code}", response_model=LabelOut)
def get_label(code: str, db: DbSession, _: CurrentUser) -> LabelOut:
    label = qr_service.get_label(db, qr_service.parse_code(code))
    return qr_service.describe(db, label)


@router.post("/labels/{code}/assign", response_model=LabelOut)
def assign(code: str, body: AssignIn, db: DbSession, user: Writer) -> LabelOut:
    label = qr_service.assign(db, qr_service.parse_code(code), body.node_id, user)
    return qr_service.describe(db, label)


@router.post("/labels/{code}/disable", response_model=LabelOut)
def disable(code: str, body: DisableIn, db: DbSession, user: Writer) -> LabelOut:
    label = qr_service.disable(db, qr_service.parse_code(code), body.reason, user)
    return qr_service.describe(db, label)


@router.post("/labels/{code}/replace", response_model=LabelOut)
def replace(code: str, body: ReplaceIn, db: DbSession, user: Writer) -> LabelOut:
    label = qr_service.replace(
        db, qr_service.parse_code(code), qr_service.parse_code(body.new_code), user
    )
    return qr_service.describe(db, label)


@router.post("/labels/{code}/reactivate", response_model=LabelOut)
def reactivate(code: str, db: DbSession, user: Admin) -> LabelOut:
    label = qr_service.reactivate(db, qr_service.parse_code(code), user)
    return qr_service.describe(db, label)
