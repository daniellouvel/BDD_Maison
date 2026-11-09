import uuid

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.api.deps import CurrentUser, DbSession, Writer
from app.core.errors import not_found
from app.models import Node
from app.schemas import LayoutIn, NodeDetail, NodeIn, NodeOut, NodePatch
from app.services import nodes as node_service

router = APIRouter(prefix="/nodes", tags=["emplacements"])


@router.get("", response_model=list[NodeOut])
def list_children(
    db: DbSession,
    _: CurrentUser,
    parent_id: uuid.UUID | None = Query(default=None, description="Absent = racine"),
) -> list[Node]:
    return node_service.children(db, parent_id)


@router.post("", response_model=NodeDetail, status_code=201)
def create_node(body: NodeIn, db: DbSession, user: Writer) -> NodeDetail:
    node = node_service.create(db, body, user)
    return node_service.detail(db, node)


@router.get("/{node_ref}", response_model=NodeDetail)
def get_node(node_ref: str, db: DbSession, _: CurrentUser) -> NodeDetail:
    """Accepte l'identifiant (UUID) ou l'adresse lisible (slug, ex. « boite-1 »)."""
    node = node_service.get_by_ref(db, node_ref)
    if node is None or node.archived_at is not None:
        raise not_found("Élément")
    return node_service.detail(db, node)


@router.patch("/{node_id}", response_model=NodeDetail)
def patch_node(node_id: uuid.UUID, body: NodePatch, db: DbSession, user: Writer) -> NodeDetail:
    node = db.get(Node, node_id)
    if node is None or node.archived_at is not None:
        raise not_found("Élément")
    node = node_service.patch(db, node, body, user)
    return node_service.detail(db, node)


@router.put("/{node_id}/layout", response_model=NodeDetail)
def set_layout(node_id: uuid.UUID, body: LayoutIn, db: DbSession, user: Writer) -> NodeDetail:
    node = db.get(Node, node_id)
    if node is None or node.archived_at is not None:
        raise not_found("Élément")
    node = node_service.set_layout(db, node, body, user)
    return node_service.detail(db, node)


@router.post("/{node_id}/archive-tree")
def archive_node_tree(node_id: uuid.UUID, db: DbSession, user: Writer) -> dict[str, int]:
    """Archive l'élément et tout son contenu (étages, cases, objets sans stock)."""
    node = db.get(Node, node_id)
    if node is None or node.archived_at is not None:
        raise not_found("Élément")
    return {"archived": node_service.archive_tree(db, node, user)}


@router.delete("/{node_id}", status_code=204)
def archive_node(node_id: uuid.UUID, db: DbSession, user: Writer) -> Response:
    node = db.get(Node, node_id)
    if node is None or node.archived_at is not None:
        raise not_found("Élément")
    node_service.archive(db, node, user)
    return Response(status_code=204)
