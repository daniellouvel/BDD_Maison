import uuid

from fastapi import APIRouter
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ApiError, not_found
from app.models import SavedView, utcnow
from app.schemas import SavedViewIn, SavedViewOut

router = APIRouter(prefix="/saved-searches", tags=["vues enregistrées"])


@router.get("", response_model=list[SavedViewOut])
def list_saved(db: DbSession, user: CurrentUser) -> list[SavedView]:
    stmt = select(SavedView).where(SavedView.user_id == user.id).order_by(SavedView.name)
    return list(db.scalars(stmt))


@router.post("", response_model=SavedViewOut, status_code=201)
def create_saved(body: SavedViewIn, db: DbSession, user: CurrentUser) -> SavedView:
    view = SavedView(user_id=user.id, name=body.name.strip(), query=body.query.strip(), created_at=utcnow())
    if not view.name or not view.query:
        raise ApiError(422, "invalid_view", "Le nom et la recherche sont requis.")
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


@router.delete("/{view_id}", status_code=204)
def delete_saved(view_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    view = db.get(SavedView, view_id)
    if view is None or view.user_id != user.id:
        raise not_found("Vue")
    db.delete(view)
    db.commit()
    return Response(status_code=204)
