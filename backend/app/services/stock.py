import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Movement, Node, User, utcnow
from app.schemas import LocationRef, MovementIn
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
        .where(*_active_items(article_id))
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
