import re
import unicodedata
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError, conflict_version
from app.models import Article, Movement, Node, NodeType, QrEvent, QrLabel, User, utcnow
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


def slugify(text: str) -> str:
    """Texte → adresse lisible : « Boîte n°1 » → « boite-n-1 »."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:180] or "element"


def assign_slug(db: Session, node: Node) -> None:
    """Donne à l'élément une adresse lisible et unique (« boite-1 », puis « boite-1-2 »…)."""
    base = slugify(label(db, node))
    candidate, n = base, 2
    while db.scalar(select(Node.id).where(Node.slug == candidate, Node.id != node.id)) is not None:
        candidate = f"{base}-{n}"
        n += 1
    node.slug = candidate


def get_by_ref(db: Session, ref: str) -> Node | None:
    """Trouve un élément par son identifiant (UUID) ou par son adresse lisible (slug)."""
    try:
        return db.get(Node, uuid.UUID(ref))
    except ValueError:
        return db.scalar(select(Node).where(Node.slug == ref))


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
        slug=node.slug,
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
    assign_slug(db, node)
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

    if "name" in fields:
        assign_slug(db, node)
    node.version += 1
    node.updated_at = utcnow()
    audit(db, "node", node, actor, "update", before=before)
    db.commit()
    db.refresh(node)
    return node


def set_layout(db: Session, node: Node, data: LayoutIn, actor: User) -> Node:
    """Enregistre le plan d'une boîte : étages (enfants de la boîte) et cases (enfants des étages).

    Les dimensions sont en millimètres ; toute case doit tenir dans le plan de la boîte.
    """
    if node.archived_at is not None:
        raise ApiError(404, "not_found", "Élément introuvable")
    if node.kind == "item":
        raise ApiError(422, "invalid_fields", "Un objet n'a pas de plan : seuls les emplacements et contenants en ont un.")
    if data.version != node.version:
        raise conflict_version()

    levels: list[dict] = []
    seen_levels: set[uuid.UUID] = set()
    seen_cells: set[uuid.UUID] = set()
    for level_in in data.levels:
        if level_in.node_id in seen_levels:
            raise ApiError(422, "duplicate_level", "Un étage apparaît deux fois dans le plan.")
        seen_levels.add(level_in.node_id)
        level = db.get(Node, level_in.node_id)
        if level is None or level.archived_at is not None or level.parent_id != node.id:
            raise ApiError(422, "invalid_level", "Chaque étage doit être un élément de la boîte.")
        if level.kind != "container":
            raise ApiError(422, "invalid_level", "Un étage doit être un contenant.")

        cells: list[dict] = []
        for cell in level_in.cells:
            if cell.node_id in seen_cells:
                raise ApiError(422, "duplicate_cell", "Une case apparaît deux fois dans le plan.")
            seen_cells.add(cell.node_id)
            child = db.get(Node, cell.node_id)
            if child is None or child.archived_at is not None or child.parent_id != level.id:
                raise ApiError(422, "invalid_cell", "Chaque case doit être un élément de son étage.")
            if child.kind != "container":
                raise ApiError(422, "invalid_cell", "Une case doit être un contenant.")
            if cell.x + cell.w > data.width_mm + 0.01 or cell.y + cell.h > data.height_mm + 0.01:
                raise ApiError(422, "invalid_cell", "Une case dépasse les dimensions de la boîte.")
            cells.append(
                {"node_id": str(cell.node_id), "x": cell.x, "y": cell.y, "w": cell.w, "h": cell.h}
            )
        levels.append({"node_id": str(level_in.node_id), "cells": cells})

    before = snapshot(node)
    node.layout = {"width_mm": data.width_mm, "height_mm": data.height_mm, "levels": levels}
    node.version += 1
    node.updated_at = utcnow()
    audit(db, "node", node, actor, "update", before=before)
    db.commit()
    db.refresh(node)
    return node


def _release_label(db: Session, node: Node, actor: User) -> None:
    """L'élément est supprimé : son étiquette redevient disponible (l'historique est conservé)."""
    label = db.scalar(select(QrLabel).where(QrLabel.assigned_node_id == node.id))
    if label is None:
        return
    label.status = "available"
    label.assigned_node_id = None
    label.updated_at = utcnow()
    db.add(
        QrEvent(
            code=label.code,
            event="released",
            node_id=node.id,
            detail="Élément supprimé",
            actor_id=actor.id,
            at=utcnow(),
        )
    )


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
    _release_label(db, node, actor)
    audit(db, "node", node, actor, "archive", before=before)
    db.commit()


def _subtree(db: Session, node: Node) -> list[Node]:
    """L'élément et tous ses descendants actifs, les plus profonds en premier."""
    result: list[Node] = []

    def visit(current: Node) -> None:
        for child in db.scalars(
            select(Node).where(Node.parent_id == current.id, Node.archived_at.is_(None))
        ).all():
            visit(child)
        result.append(current)

    visit(node)
    return result


def archive_tree(db: Session, node: Node, actor: User) -> int:
    """Archive un élément avec tout ce qu'il contient. Refusé si un objet a encore du stock."""
    if node.archived_at is not None:
        raise ApiError(404, "not_found", "Élément introuvable")
    tree = _subtree(db, node)
    blocked = [label(db, n) for n in tree if n.kind == "item" and n.quantity and n.quantity > 0]
    if blocked:
        names = ", ".join(blocked[:10]) + (" …" if len(blocked) > 10 else "")
        raise ApiError(
            409,
            "stock_remaining",
            f"Ces objets ont encore du stock, sortez-les d'abord : {names}",
        )
    now = utcnow()
    for current in tree:
        before = snapshot(current)
        current.archived_at = now
        current.version += 1
        _release_label(db, current, actor)
        audit(db, "node", current, actor, "archive", before=before)
    db.commit()
    return len(tree)
