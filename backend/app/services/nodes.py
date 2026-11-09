import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, conflict_version
from app.models import Article, Attachment, Movement, Node, NodeType, QrLabel, User, utcnow
from app.schemas import BreadcrumbItem, LayoutIn, NodeDetail, NodeIn, NodePatch
from app.services.common import audit, get_active, snapshot


def label(db: Session, node: Node) -> str:
    if node.name:
        return node.name
    if node.article_id is not None:
        article = db.get(Article, node.article_id)
        if article is not None:
            return article.name
    return "Sans nom"


def path_of(db: Session, node: Node) -> list[Node]:
    """Chaîne des ancêtres du nœud, de la racine jusqu'au nœud lui-même."""
    chain: list[Node] = []
    seen: set[uuid.UUID] = set()
    current: Node | None = node
    while current is not None and current.id not in seen:
        seen.add(current.id)
        chain.append(current)
        current = db.get(Node, current.parent_id) if current.parent_id else None
    return list(reversed(chain))


def container_path_names(db: Session, node: Node) -> list[str]:
    """Noms des conteneurs au-dessus d'un nœud (sans le nœud lui-même)."""
    if node.parent_id is None:
        return []
    parent = db.get(Node, node.parent_id)
    return [label(db, n) for n in path_of(db, parent)] if parent else []


def _would_create_cycle(db: Session, node: Node, new_parent: Node) -> bool:
    current: Node | None = new_parent
    while current is not None:
        if current.id == node.id:
            return True
        current = db.get(Node, current.parent_id) if current.parent_id else None
    return False


def has_active_children(db: Session, node: Node) -> bool:
    count = db.scalar(
        select(func.count())
        .select_from(Node)
        .where(Node.parent_id == node.id, Node.archived_at.is_(None))
    )
    return bool(count)


def children(db: Session, parent_id: uuid.UUID | None) -> list[Node]:
    stmt = select(Node).where(Node.archived_at.is_(None))
    stmt = stmt.where(Node.parent_id.is_(None) if parent_id is None else Node.parent_id == parent_id)
    return list(db.scalars(stmt.order_by(Node.kind, Node.name, Node.created_at)))


def detail(db: Session, node: Node) -> NodeDetail:
    crumbs = [BreadcrumbItem(id=n.id, name=label(db, n)) for n in path_of(db, node)]
    count = db.scalar(
        select(func.count())
        .select_from(Node)
        .where(Node.parent_id == node.id, Node.archived_at.is_(None))
    )
    article_name = None
    if node.article_id is not None:
        article = db.get(Article, node.article_id)
        article_name = article.name if article else None
    qr_code = db.scalar(select(QrLabel.code).where(QrLabel.assigned_node_id == node.id))
    return NodeDetail(
        qr_code=qr_code,
        archived=node.archived_at is not None,
        id=node.id,
        parent_id=node.parent_id,
        kind=node.kind,
        node_type_id=node.node_type_id,
        name=node.name,
        article_id=node.article_id,
        quantity=node.quantity,
        unit=node.unit,
        notes=node.notes,
        version=node.version,
        updated_at=node.updated_at,
        breadcrumb=crumbs,
        children_count=int(count or 0),
        article_name=article_name,
        layout=node.layout,
    )


def create(db: Session, data: NodeIn, actor: User) -> Node:
    if data.kind in ("location", "container"):
        if not data.name:
            raise ApiError(422, "name_required", "Un emplacement ou un contenant doit avoir un nom.")
        if data.article_id is not None or data.quantity is not None:
            raise ApiError(422, "invalid_fields", "Article et quantité ne concernent que les objets.")
    else:
        if data.article_id is None or data.quantity is None:
            raise ApiError(
                422, "item_fields_required", "Un objet doit référencer un article et une quantité."
            )
        get_active(db, Article, data.article_id, "Article")

    parent = None
    if data.parent_id is not None:
        parent = get_active(db, Node, data.parent_id, "Emplacement parent")
        if parent.kind == "item":
            raise ApiError(422, "invalid_parent", "Un objet ne peut pas contenir d'autres éléments.")
    if data.node_type_id is not None and db.get(NodeType, data.node_type_id) is None:
        raise ApiError(404, "not_found", "Type introuvable")

    node = Node(
        kind=data.kind,
        parent_id=data.parent_id,
        node_type_id=data.node_type_id,
        name=data.name,
        article_id=data.article_id,
        quantity=data.quantity if data.kind == "item" else None,
        unit=data.unit,
        notes=data.notes,
        version=1,
    )
    db.add(node)
    db.flush()
    if node.kind == "item" and node.quantity and node.quantity > 0:
        db.add(
            Movement(
                node_id=node.id,
                article_id=node.article_id,
                delta=node.quantity,
                kind="in",
                to_node_id=parent.id if parent else None,
                reason="Création de l'objet",
                actor_id=actor.id,
            )
        )
    audit(db, "node", node, actor, "create")
    db.commit()
    db.refresh(node)
    return node


def patch(db: Session, node: Node, data: NodePatch, actor: User) -> Node:
    if node.archived_at is not None:
        raise ApiError(404, "not_found", "Élément introuvable")
    if data.version != node.version:
        raise conflict_version()

    before = snapshot(node)
    fields = data.model_fields_set

    if "name" in fields:
        if data.name is None and node.kind != "item":
            raise ApiError(422, "name_required", "Un emplacement ou un contenant doit avoir un nom.")
        node.name = data.name
    if "node_type_id" in fields:
        if data.node_type_id is not None and db.get(NodeType, data.node_type_id) is None:
            raise ApiError(404, "not_found", "Type introuvable")
        node.node_type_id = data.node_type_id
    if "notes" in fields:
        node.notes = data.notes
    if "unit" in fields:
        if node.kind != "item" and data.unit:
            raise ApiError(422, "invalid_fields", "L'unité ne concerne que les objets.")
        node.unit = data.unit

    moved = False
    old_parent = node.parent_id
    if "parent_id" in fields and data.parent_id != node.parent_id:
        if data.parent_id is not None:
            new_parent = get_active(db, Node, data.parent_id, "Emplacement de destination")
            if new_parent.kind == "item":
                raise ApiError(422, "invalid_parent", "Un objet ne peut pas contenir d'autres éléments.")
            if _would_create_cycle(db, node, new_parent):
                raise ApiError(422, "cycle", "Un élément ne peut pas être placé dans lui-même.")
        node.parent_id = data.parent_id
        moved = True

    if moved and node.kind == "item":
        db.add(
            Movement(
                node_id=node.id,
                article_id=node.article_id,
                delta=0,
                kind="move",
                from_node_id=old_parent,
                to_node_id=node.parent_id,
                actor_id=actor.id,
            )
        )

    node.version += 1
    node.updated_at = utcnow()
    audit(db, "node", node, actor, "update", before=before)
    db.commit()
    db.refresh(node)
    return node


def set_layout(db: Session, node: Node, data: LayoutIn, actor: User) -> Node:
    """Enregistre le plan d'un contenant : photo et cases (chacune = un enfant du contenant)."""
    if node.archived_at is not None:
        raise ApiError(404, "not_found", "Élément introuvable")
    if node.kind == "item":
        raise ApiError(422, "invalid_fields", "Un objet n'a pas de plan.")
    if data.version != node.version:
        raise conflict_version()

    if data.photo_id is not None:
        photo = db.get(Attachment, data.photo_id)
        if photo is None or photo.kind != "photo" or photo.node_id != node.id:
            raise ApiError(422, "invalid_photo", "La photo doit être ajoutée à ce contenant.")

    seen: set[uuid.UUID] = set()
    cells: list[dict] = []
    for cell in data.cells:
        if cell.node_id in seen:
            raise ApiError(422, "duplicate_cell", "Une case apparaît deux fois dans le plan.")
        seen.add(cell.node_id)
        child = db.get(Node, cell.node_id)
        if child is None or child.archived_at is not None or child.parent_id != node.id:
            raise ApiError(422, "invalid_cell", "Chaque case doit être un élément du contenant.")
        if child.kind == "item":
            raise ApiError(422, "invalid_cell", "Une case ne peut pas être un objet.")
        if cell.x + cell.w > 1.001 or cell.y + cell.h > 1.001:
            raise ApiError(422, "invalid_cell", "Une case dépasse la photo.")
        cells.append(
            {"node_id": str(cell.node_id), "x": cell.x, "y": cell.y, "w": cell.w, "h": cell.h}
        )

    before = snapshot(node)
    node.layout = {"photo_id": str(data.photo_id) if data.photo_id else None, "cells": cells}
    node.version += 1
    node.updated_at = utcnow()
    audit(db, "node", node, actor, "update", before=before)
    db.commit()
    db.refresh(node)
    return node


def archive(db: Session, node: Node, actor: User) -> None:
    if node.archived_at is not None:
        raise ApiError(404, "not_found", "Élément introuvable")
    if has_active_children(db, node):
        raise ApiError(
            409, "node_not_empty", "Cet élément contient encore des éléments. Déplacez-les d'abord."
        )
    if node.kind == "item" and node.quantity and node.quantity > 0:
        raise ApiError(409, "stock_remaining", "Cet objet a encore une quantité en stock.")
    before = snapshot(node)
    node.archived_at = utcnow()
    node.version += 1
    audit(db, "node", node, actor, "archive", before=before)
    db.commit()
