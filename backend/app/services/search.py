import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Article, Category, Movement, Node
from app.schemas import (
    ArticleOut,
    DashboardOut,
    MovementOut,
    SearchHit,
)
from app.services import catalog, qr, stock
from app.services import nodes as node_service


def _descendant_ids(db: Session, model, root_id: uuid.UUID) -> set[uuid.UUID]:  # type: ignore[no-untyped-def]
    """Identifiants d'un nœud et de tout ce qu'il contient (catégories ou emplacements)."""
    found = {root_id}
    frontier = {root_id}
    while frontier:
        rows = db.scalars(select(model.id).where(model.parent_id.in_(frontier))).all()
        frontier = {r for r in rows if r not in found}
        found |= frontier
    return found


def _filtered_ids(
    db: Session,
    category_id: uuid.UUID | None,
    place_id: uuid.UUID | None,
    low_stock: bool,
    lent: bool,
) -> set[uuid.UUID] | None:
    """Articles qui respectent tous les filtres demandés (None : aucun filtre)."""
    result: set[uuid.UUID] | None = None

    def narrow(ids: set[uuid.UUID]) -> None:
        nonlocal result
        result = ids if result is None else result & ids

    if category_id is not None:
        cats = _descendant_ids(db, Category, category_id)
        narrow(set(db.scalars(select(Article.id).where(Article.category_id.in_(cats), Article.archived_at.is_(None)))))
    if place_id is not None:
        places = _descendant_ids(db, Node, place_id)
        narrow(
            set(
                db.scalars(
                    select(Node.article_id).where(
                        Node.kind == "item", Node.archived_at.is_(None), Node.parent_id.in_(places), Node.article_id.is_not(None)
                    )
                )
            )
        )
    if low_stock:
        arts = list(db.scalars(select(Article).where(Article.archived_at.is_(None), Article.min_quantity.is_not(None))))
        totals = stock.totals_by_article(db, [a.id for a in arts])
        narrow({a.id for a in arts if totals.get(a.id, Decimal(0)) < (a.min_quantity or 0)})
    if lent:
        narrow(
            set(
                db.scalars(
                    select(Node.article_id).where(Node.kind == "item", Node.archived_at.is_(None), Node.status == "lent")
                )
            )
        )
    return result


def search_articles(
    db: Session,
    q: str | None,
    limit: int = 50,
    category_id: uuid.UUID | None = None,
    place_id: uuid.UUID | None = None,
    low_stock: bool = False,
    lent: bool = False,
) -> list[SearchHit]:
    ids = _filtered_ids(db, category_id, place_id, low_stock, lent)
    articles = catalog.list_articles(db, q=q or None, category_id=None, limit=limit, offset=0, ids=ids)
    totals = stock.totals_by_article(db, [a.id for a in articles])
    photos = catalog.main_photos(db, [a.id for a in articles])
    return [
        SearchHit(
            article=ArticleOut.model_validate(a),
            photo_id=photos.get(a.id),
            total_quantity=totals.get(a.id, Decimal(0)),
            locations=stock.locations_for(db, a.id),
        )
        for a in articles
    ]


def dashboard(db: Session) -> DashboardOut:
    def count(*criteria) -> int:  # type: ignore[no-untyped-def]
        return int(
            db.scalar(select(func.count()).select_from(Node).where(*criteria)) or 0
        )

    active = Node.archived_at.is_(None)
    articles = list(
        db.scalars(select(Article).where(Article.archived_at.is_(None), Article.min_quantity.is_not(None)))
    )
    totals = stock.totals_by_article(db, [a.id for a in articles])
    low = [ArticleOut.model_validate(a) for a in articles if totals.get(a.id, Decimal(0)) < (a.min_quantity or 0)]

    unlocated = list(
        db.scalars(
            select(Node).where(Node.kind == "item", Node.parent_id.is_(None), active).limit(50)
        )
    )
    recent = list(db.scalars(select(Movement).order_by(Movement.created_at.desc()).limit(10)))
    labels = qr.count_by_status(db)

    return DashboardOut(
        labels_available=labels["available"],
        labels_assigned=labels["assigned"],
        articles=int(
            db.scalar(select(func.count()).select_from(Article).where(Article.archived_at.is_(None))) or 0
        ),
        containers=count(Node.kind == "container", active),
        locations=count(Node.kind == "location", active),
        items=count(Node.kind == "item", active),
        low_stock=low,
        unlocated=[node_service.detail(db, n) for n in unlocated],
        recent_movements=[MovementOut.model_validate(m) for m in recent],
    )
