"""Export et import CSV de l'inventaire (un lot par ligne), au format lisible par un tableur français."""

import csv
import io
import unicodedata
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Article, Category, Node, QrLabel, User
from app.schemas import ArticleIn, NodeIn
from app.services import catalog
from app.services import nodes as node_service

COLUMNS = ["Nom", "Marque", "Référence", "Catégorie", "Quantité", "Unité", "Emplacement", "Statut", "Étiquette"]
MAX_ROWS = 5000
MAX_BYTES = 2_000_000
STATUS_FR = {"in_stock": "En stock", "lent": "Prêté", "removed": "Sorti"}


def export_csv(db: Session) -> str:
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow(COLUMNS)
    categories = {c.id: c.name for c in db.scalars(select(Category))}
    labels = {
        n: code
        for n, code in db.execute(
            select(QrLabel.assigned_node_id, QrLabel.code).where(QrLabel.assigned_node_id.is_not(None))
        ).all()
    }
    items = db.scalars(select(Node).where(Node.kind == "item", Node.archived_at.is_(None))).all()
    rows = []
    for item in items:
        article = db.get(Article, item.article_id) if item.article_id else None
        parent = db.get(Node, item.parent_id) if item.parent_id else None
        place = " > ".join(node_service.label(db, n) for n in node_service.path_of(db, parent)) if parent else ""
        rows.append(
            [
                article.name if article else (item.name or ""),
                (article.brand if article else "") or "",
                (article.mpn if article else "") or "",
                categories.get(article.category_id, "") if article and article.category_id else "",
                str(item.quantity if item.quantity is not None else 0).rstrip("0").rstrip("."),
                item.unit or "",
                place,
                STATUS_FR.get(item.status, item.status),
                labels.get(item.id, ""),
            ]
        )
    rows.sort(key=lambda r: (r[6].lower(), r[0].lower()))
    writer.writerows(rows)
    return out.getvalue()


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").strip().lower()


ALIASES = {
    "nom": "name",
    "designation": "name",
    "article": "name",
    "marque": "brand",
    "reference": "mpn",
    "ref": "mpn",
    "categorie": "category",
    "quantite": "quantity",
    "qte": "quantity",
    "unite": "unit",
    "emplacement": "place",
    "lieu": "place",
}


def _read_rows(raw: bytes) -> list[dict[str, str]]:
    if len(raw) > MAX_BYTES:
        raise ApiError(413, "file_too_large", "Fichier trop volumineux (2 Mo maximum).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
    first = text.splitlines()[0] if text.strip() else ""
    delimiter = ";" if first.count(";") >= first.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration:
        raise ApiError(422, "empty_file", "Le fichier est vide.") from None
    keys = [ALIASES.get(_plain(h)) for h in header]
    if "name" not in keys:
        raise ApiError(422, "missing_column", "Colonne « Nom » introuvable en première ligne.")
    rows: list[dict[str, str]] = []
    for record in reader:
        if not any(cell.strip() for cell in record):
            continue
        rows.append({k: record[i].strip() for i, k in enumerate(keys) if k and i < len(record)})
    if len(rows) > MAX_ROWS:
        raise ApiError(413, "too_many_rows", f"{MAX_ROWS} lignes au maximum par import.")
    return rows


def _place(db: Session, path: str, actor: User, cache: dict[tuple[str, ...], Node], create: bool) -> Node | None:
    parts = [p.strip() for p in path.replace("›", ">").split(">") if p.strip()]
    parent: Node | None = None
    walked: list[str] = []
    for depth, name in enumerate(parts):
        walked.append(name.lower())
        key = tuple(walked)
        if key in cache:
            parent = cache[key]
            continue
        found = db.scalar(
            select(Node).where(
                Node.archived_at.is_(None),
                Node.kind != "item",
                func.lower(Node.name) == name.lower(),
                Node.parent_id.is_(None) if parent is None else Node.parent_id == parent.id,
            )
        )
        if found is None:
            if not create:
                return None
            found = node_service.create(
                db,
                NodeIn(kind="location" if depth == 0 else "container", name=name, parent_id=parent.id if parent else None),
                actor,
            )
        cache[key] = found
        parent = found
    return parent


def import_csv(db: Session, raw: bytes, actor: User, dry_run: bool) -> dict[str, object]:
    rows = _read_rows(raw)
    categories = {c.name.lower(): c.id for c in db.scalars(select(Category))}
    cache: dict[tuple[str, ...], Node] = {}
    created_articles = 0
    created_lots = 0
    created_places_before = db.scalar(select(func.count()).select_from(Node).where(Node.kind != "item")) or 0
    problems: list[str] = []
    seen_articles: set[str] = set()

    for number, row in enumerate(rows, start=2):
        name = row.get("name", "")
        if not name:
            problems.append(f"Ligne {number} : nom manquant, ignorée.")
            continue
        try:
            quantity = Decimal((row.get("quantity") or "1").replace(",", ".").replace(" ", ""))
            if quantity < 0:
                raise InvalidOperation
        except InvalidOperation:
            problems.append(f"Ligne {number} : quantité invalide « {row.get('quantity')} », ignorée.")
            continue
        unit = row.get("unit") or None
        try:
            node_service.check_unit(unit)
        except ApiError as e:
            problems.append(f"Ligne {number} : {e.message}")
            continue

        article = db.scalar(
            select(Article).where(Article.archived_at.is_(None), func.lower(Article.name) == name.lower())
        )
        if article is None and name.lower() not in seen_articles:
            created_articles += 1
        seen_articles.add(name.lower())
        created_lots += 1
        if dry_run:
            _place(db, row.get("place", ""), actor, cache, create=False)
            continue

        if article is None:
            article = catalog.create_article(
                db,
                ArticleIn(
                    name=name,
                    brand=row.get("brand") or None,
                    mpn=row.get("mpn") or None,
                    category_id=categories.get((row.get("category") or "").lower()),
                ),
                actor,
            )
        parent = _place(db, row.get("place", ""), actor, cache, create=True)
        node_service.create(
            db,
            NodeIn(kind="item", article_id=article.id, quantity=quantity, unit=unit, parent_id=parent.id if parent else None),
            actor,
        )

    places_after = db.scalar(select(func.count()).select_from(Node).where(Node.kind != "item")) or 0
    return {
        "dry_run": dry_run,
        "rows": len(rows),
        "articles_created": created_articles,
        "lots_created": created_lots,
        "places_created": 0 if dry_run else places_after - created_places_before,
        "problems": problems[:50],
    }
