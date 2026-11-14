import uuid

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ApiError
from app.schemas import DashboardOut, SearchHit
from app.services import search as search_service

router = APIRouter(tags=["recherche"])


@router.get("/search", response_model=list[SearchHit])
def search(
    db: DbSession,
    _: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    category_id: uuid.UUID | None = None,
    place_id: uuid.UUID | None = None,
    low_stock: bool = False,
    lent: bool = False,
) -> list[SearchHit]:
    term = (q or "").strip()
    if not term and category_id is None and place_id is None and not low_stock and not lent:
        raise ApiError(422, "query_required", "Tapez un mot ou choisissez un filtre.")
    return search_service.search_articles(db, term or None, limit, category_id, place_id, low_stock, lent)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DbSession, _: CurrentUser) -> DashboardOut:
    return search_service.dashboard(db)
