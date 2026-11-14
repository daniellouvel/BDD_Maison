import datetime as dt

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import Response

from app.api.deps import CurrentUser, DbSession, Writer
from app.api.files import read_upload
from app.services import exchange

router = APIRouter(tags=["échanges"])


@router.get("/export/inventory.csv")
def export_inventory(db: DbSession, _: CurrentUser) -> Response:
    content = "﻿" + exchange.export_csv(db)  # BOM : Excel lit bien les accents
    name = f"inventaire-{dt.date.today().isoformat()}.csv"
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/import/inventory")
def import_inventory(
    db: DbSession,
    user: Writer,
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
) -> dict[str, object]:
    return exchange.import_csv(db, read_upload(file), user, dry_run)
