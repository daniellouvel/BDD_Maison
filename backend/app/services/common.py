from typing import Any, TypeVar

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.errors import ApiError, not_found
from app.models import AuditLog, User, utcnow

T = TypeVar("T")


def snapshot(obj: Any) -> dict[str, Any]:
    """Copie JSON-compatible des colonnes d'une entité (pour l'historique)."""
    columns = obj.__table__.columns
    return jsonable_encoder({c.key: getattr(obj, c.key) for c in columns})


def audit(
    db: Session,
    entity: str,
    obj: Any,
    actor: User | None,
    action: str,
    before: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            entity=entity,
            entity_id=obj.id,
            actor_id=actor.id if actor else None,
            action=action,
            before=before,
            after=None if action == "delete" else snapshot(obj),
            at=utcnow(),
        )
    )


def get_active(db: Session, model: type[T], item_id: Any, label: str) -> T:
    obj = db.get(model, item_id)
    if obj is None or getattr(obj, "archived_at", None) is not None:
        raise not_found(label)
    return obj


def like_escape(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def require_known(obj: Any, label: str) -> Any:
    if obj is None:
        raise ApiError(404, "not_found", f"{label} introuvable")
    return obj
