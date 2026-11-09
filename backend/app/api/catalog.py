import uuid

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, Writer
from app.models import Article, Category, FieldDef, NodeType
from app.schemas import (
    ArticleDetail,
    ArticleIn,
    ArticleOut,
    ArticlePatch,
    CategoryIn,
    CategoryOut,
    FieldDefIn,
    FieldDefOut,
    NodeTypeIn,
    NodeTypeOut,
)
from app.services import catalog
from app.core.errors import not_found
from app.services.common import get_active

router = APIRouter(tags=["catalogue"])


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: DbSession, _: CurrentUser) -> list[Category]:
    return list(db.scalars(select(Category).order_by(Category.name)))


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, db: DbSession, user: Writer) -> Category:
    return catalog.create_category(db, body, user)


@router.get("/categories/{category_id}/fields", response_model=list[FieldDefOut])
def list_fields(category_id: uuid.UUID, db: DbSession, _: CurrentUser) -> list[FieldDef]:
    catalog.get_active_category(db, category_id)
    return list(db.scalars(select(FieldDef).where(FieldDef.category_id == category_id)))


@router.post("/categories/{category_id}/fields", response_model=FieldDefOut, status_code=201)
def add_field(category_id: uuid.UUID, body: FieldDefIn, db: DbSession, user: Writer) -> FieldDef:
    return catalog.add_field(db, category_id, body, user)


@router.get("/node-types", response_model=list[NodeTypeOut])
def list_node_types(db: DbSession, _: CurrentUser) -> list[NodeType]:
    return list(db.scalars(select(NodeType).order_by(NodeType.name)))


@router.post("/node-types", response_model=NodeTypeOut, status_code=201)
def create_node_type(body: NodeTypeIn, db: DbSession, user: Writer) -> NodeType:
    return catalog.create_node_type(db, body, user)


@router.delete("/node-types/{node_type_id}", status_code=204)
def delete_node_type(node_type_id: uuid.UUID, db: DbSession, user: Writer) -> Response:
    catalog.delete_node_type(db, node_type_id, user)
    return Response(status_code=204)


@router.get("/articles", response_model=list[ArticleOut])
def list_articles(
    db: DbSession,
    _: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    category_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[Article]:
    return catalog.list_articles(db, q, category_id, limit, offset)


@router.post("/articles", response_model=ArticleDetail, status_code=201)
def create_article(body: ArticleIn, db: DbSession, user: Writer) -> ArticleDetail:
    article = catalog.create_article(db, body, user)
    return catalog.article_detail(db, article)


@router.get("/articles/{article_id}", response_model=ArticleDetail)
def get_article(article_id: uuid.UUID, db: DbSession, _: CurrentUser) -> ArticleDetail:
    article = get_active(db, Article, article_id, "Article")
    return catalog.article_detail(db, article)


@router.patch("/articles/{article_id}", response_model=ArticleDetail)
def patch_article(
    article_id: uuid.UUID, body: ArticlePatch, db: DbSession, user: Writer
) -> ArticleDetail:
    article = db.get(Article, article_id)
    if article is None or article.archived_at is not None:
        raise not_found("Article")
    article = catalog.update_article(db, article, body, user)
    return catalog.article_detail(db, article)


@router.delete("/articles/{article_id}", status_code=204)
def delete_article(article_id: uuid.UUID, db: DbSession, user: Writer) -> Response:
    article = get_active(db, Article, article_id, "Article")
    catalog.archive_article(db, article, user)
    return Response(status_code=204)
