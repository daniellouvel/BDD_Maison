import datetime as dt
import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Article, Movement, Node, User, utcnow
from app.schemas import LocationRef, MovementEntry, MovementIn
from app.services import nodes as node_service
from app.services.common import get_active

ZERO = Decimal("0")


def _active_items(article_id: uuid.UUID):  # type: ignore[no-untyped-def]
    return (
        Node.kind == "item",
        Node.article_id == article_id,
        Node.archived_at.is_(None),
    )


def total_quantity(db: Session, article_id: uuid.UUID) -> Decimal:
    value = db.scalar(
        select(func.coalesce(func.sum(Node.quantity), 0)).where(*_active_items(article_id))
    )
    return Decimal(value or 0)


def totals_by_article(db: Session, article_ids: list[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    if not article_ids:
        return {}
    rows = db.execute(
        select(Node.article_id, func.sum(Node.quantity))
        .where(
            Node.kind == "item",
            Node.article_id.in_(article_ids),
            Node.archived_at.is_(None),
        )
        .group_by(Node.article_id)
    ).all()
    result = {aid: Decimal(qty or 0) for aid, qty in rows}
    return {aid: result.get(aid, ZERO) for aid in article_ids}


def locations_for(db: Session, article_id: uuid.UUID) -> list[LocationRef]:
    items = db.scalars(
        select(Node)
        .where(*_active_items(article_id), Node.status != "removed")
        .order_by(Node.created_at)
    ).all()
    refs: list[LocationRef] = []
    for item in items:
        parent = db.get(Node, item.parent_id) if item.parent_id else None
        path = node_service.path_of(db, parent) if parent else []
        refs.append(
            LocationRef(
                node_id=item.id,
                quantity=item.quantity or ZERO,
                path=[node_service.label(db, n) for n in path],
                status=item.status,
            )
        )
    return refs


def _find_by_op(db: Session, op_id: uuid.UUID | None) -> Movement | None:
    if op_id is None:
        return None
    return db.scalar(select(Movement).where(Movement.op_id == op_id))


def apply(db: Session, data: MovementIn, actor: User) -> Movement:
    """Applique un mouvement. Idempotent si `op_id` est fourni (rejeu après coupure réseau)."""
    existing = _find_by_op(db, data.op_id)
    if existing is not None:
        return existing

    node = db.scalar(select(Node).where(Node.id == data.node_id).with_for_update())
    if node is None or node.archived_at is not None:
        raise ApiError(404, "not_found", "Objet introuvable")
    if node.kind != "item":
        raise ApiError(422, "not_item", "Les mouvements de stock ne concernent que les objets.")
    if node.status != "in_stock":
        raise ApiError(422, "item_not_in_stock", "Ce lot est prêté ou sorti : il ne peut pas être modifié.")

    if data.kind == "move":
        if data.to_node_id is None:
            raise ApiError(422, "destination_required", "Une destination est requise.")
        destination = get_active(db, Node, data.to_node_id, "Destination")
        if destination.kind == "item":
            raise ApiError(422, "invalid_parent", "Un objet ne peut pas contenir d'autres éléments.")
        movement = Movement(
            node_id=node.id,
            article_id=node.article_id,
            delta=ZERO,
            kind="move",
            from_node_id=node.parent_id,
            to_node_id=destination.id,
            reason=data.reason,
            actor_id=actor.id,
            op_id=data.op_id,
        )
        node.parent_id = destination.id
    else:
        if data.delta is None:
            raise ApiError(422, "delta_required", "Une quantité est requise.")
        if data.kind in ("in", "out", "consume") and data.delta <= 0:
            raise ApiError(422, "delta_positive", "La quantité doit être positive.")
        if data.kind == "adjust":
            if data.delta == 0:
                raise ApiError(422, "delta_zero", "L'ajustement ne peut pas être nul.")
            if not data.reason:
                raise ApiError(422, "reason_required", "Un ajustement doit être justifié.")
        signed = -data.delta if data.kind in ("out", "consume") else data.delta
        new_quantity = (node.quantity or ZERO) + signed
        if new_quantity < 0:
            raise ApiError(
                422,
                "stock_insuffisant",
                f"Stock insuffisant : {node.quantity} disponible.",
            )
        node.quantity = new_quantity
        movement = Movement(
            node_id=node.id,
            article_id=node.article_id,
            delta=signed,
            kind=data.kind,
            reason=data.reason,
            actor_id=actor.id,
            op_id=data.op_id,
        )

    node.version += 1
    node.updated_at = utcnow()
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return movement


def history(
    db: Session,
    node_id: uuid.UUID | None,
    article_id: uuid.UUID | None,
    limit: int,
) -> list[Movement]:
    stmt = select(Movement).order_by(Movement.created_at.desc()).limit(limit)
    if node_id is not None:
        stmt = stmt.where(Movement.node_id == node_id)
    if article_id is not None:
        stmt = stmt.where(Movement.article_id == article_id)
    return list(db.scalars(stmt))


UNDO_WINDOW_HOURS = 24


def _path_names(db: Session, node_id: uuid.UUID | None) -> list[str] | None:
    node = db.get(Node, node_id) if node_id else None
    if node is None:
        return None
    return [node_service.label(db, n) for n in node_service.path_of(db, node)]


def _undoable(db: Session, movement: Movement) -> bool:
    if movement.kind not in ("in", "out", "consume", "move"):
        return False
    if movement.kind == "move" and movement.from_node_id is None:
        return False
    if utcnow() - movement.created_at > dt.timedelta(hours=UNDO_WINDOW_HOURS):
        return False
    node = db.get(Node, movement.node_id)
    if node is None or node.archived_at is not None or node.status != "in_stock":
        return False
    latest = db.scalar(
        select(Movement.id).where(Movement.node_id == movement.node_id).order_by(Movement.created_at.desc(), Movement.id.desc()).limit(1)
    )
    return latest == movement.id


def timeline(db: Session, node_id: uuid.UUID | None, article_id: uuid.UUID | None, limit: int) -> list[MovementEntry]:
    entries: list[MovementEntry] = []
    for m in history(db, node_id, article_id, limit):
        article = db.get(Article, m.article_id)
        actor = db.get(User, m.actor_id) if m.actor_id else None
        entries.append(
            MovementEntry(
                id=m.id,
                node_id=m.node_id,
                article_id=m.article_id,
                article_name=article.name if article else "?",
                kind=m.kind,
                delta=m.delta,
                reason=m.reason,
                actor=actor.username if actor else None,
                created_at=m.created_at,
                node_path=_path_names(db, m.node_id) or [],
                from_path=_path_names(db, m.from_node_id),
                to_path=_path_names(db, m.to_node_id),
                undoable=_undoable(db, m),
            )
        )
    return entries


def undo(db: Session, movement_id: uuid.UUID, actor: User) -> Movement:
    """Annule le dernier mouvement d'un lot par le mouvement inverse (le journal garde les deux)."""
    movement = db.get(Movement, movement_id)
    if movement is None:
        raise ApiError(404, "not_found", "Mouvement introuvable")
    if not _undoable(db, movement):
        raise ApiError(409, "not_undoable", "Ce mouvement ne peut plus être annulé (un autre a eu lieu depuis, ou il date de plus d'un jour).")
    if movement.kind == "move":
        inverse = MovementIn(node_id=movement.node_id, kind="move", to_node_id=movement.from_node_id, reason="Annulation")
    else:
        kind = "out" if movement.kind == "in" else "in"
        inverse = MovementIn(node_id=movement.node_id, kind=kind, delta=abs(movement.delta), reason="Annulation")
    return apply(db, inverse, actor)
