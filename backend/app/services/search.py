from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Article, Movement, Node
from app.schemas import (
    ArticleOut,
    DashboardOut,
    MovementOut,
    SearchHit,
)
from app.services import catalog, qr, stock
from app.services import nodes as node_service


def search_articles(db: Session, q: str, limit: int = 50) -> list[SearchHit]:
    articles = catalog.list_articles(db, q=q, category_id=None, limit=limit, offset=0)
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
