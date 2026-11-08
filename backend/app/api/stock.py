import uuid

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession, Writer
from app.schemas import MovementIn, MovementOut
from app.services import stock

router = APIRouter(prefix="/stock", tags=["stock"])


@router.post("/movements", response_model=MovementOut, status_code=201)
def create_movement(body: MovementIn, db: DbSession, user: Writer) -> MovementOut:
    return MovementOut.model_validate(stock.apply(db, body, user))


@router.get("/movements", response_model=list[MovementOut])
def list_movements(
    db: DbSession,
    _: CurrentUser,
    node_id: uuid.UUID | None = None,
    article_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=500),
) -> list[MovementOut]:
    rows = stock.history(db, node_id, article_id, limit)
    return [MovementOut.model_validate(r) for r in rows]
