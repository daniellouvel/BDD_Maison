from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.schemas import DashboardOut, SearchHit
from app.services import search as search_service

router = APIRouter(tags=["recherche"])


@router.get("/search", response_model=list[SearchHit])
def search(
    db: DbSession,
    _: CurrentUser,
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[SearchHit]:
    return search_service.search_articles(db, q.strip(), limit)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DbSession, _: CurrentUser) -> DashboardOut:
    return search_service.dashboard(db)
