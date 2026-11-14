import unicodedata
import uuid
from typing import Any

from sqlalchemy import Select, Text, cast, func, literal_column, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.core.errors import ApiError, conflict_version
from app.models import Article, Attachment, Category, FieldDef, Node, NodeType, User, utcnow
from app.schemas import (
    CategoryPatch,
    FieldDefPatch,
    ArticleDetail,
    ArticleIn,
    ArticleOut,
    ArticlePatch,
    CategoryIn,
    FieldDefIn,
    NodeTypeIn,
)
from app.services import stock
from app.services.common import audit, get_active, like_escape, snapshot

# --- Catégories, champs, types de nœuds ---------------------------------------------------------


def create_category(db: Session, data: CategoryIn, actor: User) -> Category:
    if data.parent_id is not None:
        get_active_category(db, data.parent_id)
    category = Category(name=data.name, parent_id=data.parent_id)
    db.add(category)
    db.flush()
    audit(db, "category", category, actor, "create")
    db.commit()
    db.refresh(category)
    return category


def get_active_category(db: Session, category_id: uuid.UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise ApiError(404, "not_found", "Catégorie introuvable")
    return category


def add_field(db: Session, category_id: uuid.UUID, data: FieldDefIn, actor: User) -> FieldDef:
    get_active_category(db, category_id)
    if data.type == "enum" and not data.options:
        raise ApiError(422, "options_required", "Un champ de type liste nécessite des options.")
    if data.type != "enum" and data.options:
        raise ApiError(422, "invalid_options", "Les options ne concernent que les champs de type liste.")
    if data.type != "number" and data.unit:
        raise ApiError(422, "invalid_unit", "L'unité ne concerne que les champs numériques.")
    if db.scalar(
        select(FieldDef).where(FieldDef.category_id == category_id, FieldDef.key == data.key)
    ):
        raise ApiError(409, "field_exists", f"Le champ « {data.key} » existe déjà dans cette catégorie.")
    field = FieldDef(
        category_id=category_id,
        key=data.key,
        label=data.label,
        type=data.type,
        unit=data.unit,
        options=data.options,
        required=data.required,
    )
    db.add(field)
    db.flush()
    audit(db, "field_def", field, actor, "create")
    db.commit()
    db.refresh(field)
    return field


def category_chain(db: Session, category_id: uuid.UUID | None) -> list[uuid.UUID]:
    chain: list[uuid.UUID] = []
    current = category_id
    while current is not None and current not in chain:
        chain.append(current)
        category = db.get(Category, current)
        current = category.parent_id if category else None
    return chain


def inherited_fields(db: Session, category_id: uuid.UUID | None) -> dict[str, FieldDef]:
    """Champs de la catégorie et de ses ancêtres (les plus proches priment)."""
    fields: dict[str, FieldDef] = {}
    for cid in reversed(category_chain(db, category_id)):
        for field in db.scalars(select(FieldDef).where(FieldDef.category_id == cid)):
            fields[field.key] = field
    return fields


def _check_value(field: FieldDef, value: Any) -> None:
    ok = True
    if field.type == "text":
        ok = isinstance(value, str)
    elif field.type == "number":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif field.type == "bool":
        ok = isinstance(value, bool)
    elif field.type == "enum":
        ok = value in (field.options or [])
    if not ok:
        raise ApiError(422, "invalid_field_value", f"Valeur invalide pour « {field.label} ».")


def validate_attributes(
    db: Session, category_id: uuid.UUID | None, attributes: dict[str, Any]
) -> dict[str, Any]:
    values = {k: v for k, v in attributes.items() if v is not None and v != ""}
    fields = inherited_fields(db, category_id)
    if values and category_id is None:
        raise ApiError(422, "category_required", "Choisissez une catégorie pour renseigner ces champs.")
    for key, value in values.items():
        field = fields.get(key)
        if field is None:
            raise ApiError(422, "unknown_field", f"Champ inconnu : {key}.")
        _check_value(field, value)
    for field in fields.values():
        if field.required and field.key not in values:
            raise ApiError(422, "field_required", f"Le champ « {field.label} » est obligatoire.")
    return values


def delete_node_type(db: Session, node_type_id: uuid.UUID, actor: User) -> None:
    """Supprime un type. Les éléments qui l'utilisaient gardent leur nom, sans type."""
    node_type = db.get(NodeType, node_type_id)
    if node_type is None:
        raise ApiError(404, "not_found", "Type introuvable")
    audit(db, "node_type", node_type, actor, "delete")
    db.delete(node_type)
    db.commit()


def create_node_type(db: Session, data: NodeTypeIn, actor: User) -> NodeType:
    if db.scalar(select(NodeType).where(NodeType.name == data.name)):
        raise ApiError(409, "exists", "Ce type existe déjà.")
    node_type = NodeType(name=data.name, genre=data.genre)
    db.add(node_type)
    db.flush()
    audit(db, "node_type", node_type, actor, "create")
    db.commit()
    db.refresh(node_type)
    return node_type


# --- Articles -----------------------------------------------------------------------------------


_ACCENTED = "àâäçéèêëîïôöùûüÿœæ"
_PLAIN = "aaaceeeeiioouuuyoae"


def fold(text: str) -> str:
    """Minuscules sans accents : « Résistance » → « resistance »."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c)).replace("œ", "oe").replace("æ", "ae")


def _folded_column(column: Any) -> Any:
    """Même normalisation côté base : minuscules et lettres accentuées ramenées à leur forme simple."""
    return func.translate(func.lower(column), _ACCENTED, _PLAIN)


def _categories_matching(db: Session, folded_term: str) -> set[uuid.UUID]:
    """Catégories dont le nom contient le mot, avec toutes leurs sous-catégories.

    Chercher « électronique » trouve ainsi les articles rangés dans « Électronique › Régulateurs ».
    """
    rows = db.execute(select(Category.id, Category.parent_id, Category.name)).all()
    children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for category_id, parent_id, _ in rows:
        children.setdefault(parent_id, []).append(category_id)
    found: set[uuid.UUID] = set()
    stack = [category_id for category_id, _, name in rows if folded_term in fold(name)]
    while stack:
        category_id = stack.pop()
        if category_id not in found:
            found.add(category_id)
            stack.extend(children.get(category_id, []))
    return found


def article_text_clause(db: Session, q: str) -> list[Any]:
    """Chaque mot de la requête doit apparaître quelque part dans la fiche de l'article :
    nom, marque, référence, mots-clés, description, catégorie (ou catégorie parente) ou valeur
    d'un champ personnalisé.

    La comparaison ignore la casse et les accents (« resistance » trouve « Résistance »).
    """
    # Valeurs des champs personnalisés, sans leurs clés : « ["TO-220", 1.25] » en texte.
    attribute_values = cast(
        func.jsonb_path_query_array(cast(Article.attributes, JSONB), literal_column("'$.*'::jsonpath")), Text
    )
    clauses = []
    for term in q.split():
        folded = fold(term)
        pattern = f"%{like_escape(folded)}%"
        fields = [
            _folded_column(Article.name).like(pattern, escape="\\"),
            _folded_column(Article.brand).like(pattern, escape="\\"),
            _folded_column(Article.mpn).like(pattern, escape="\\"),
            _folded_column(Article.keywords).like(pattern, escape="\\"),
            _folded_column(Article.description).like(pattern, escape="\\"),
            _folded_column(attribute_values).like(pattern, escape="\\"),
        ]
        categories = _categories_matching(db, folded)
        if categories:
            fields.append(Article.category_id.in_(categories))
        clauses.append(or_(*fields))
    return clauses


def list_articles(
    db: Session,
    q: str | None,
    category_id: uuid.UUID | None,
    limit: int,
    offset: int,
    ids: set[uuid.UUID] | None = None,
) -> list[Article]:
    stmt: Select[tuple[Article]] = select(Article).where(Article.archived_at.is_(None))
    if ids is not None:
        stmt = stmt.where(Article.id.in_(ids))
    if q:
        stmt = stmt.where(*article_text_clause(db, q))
    if category_id is not None:
        stmt = stmt.where(Article.category_id == category_id)
    stmt = stmt.order_by(func.lower(Article.name)).limit(limit).offset(offset)
    return list(db.scalars(stmt))


def article_out(article: Article) -> ArticleOut:
    return ArticleOut.model_validate(article)


def article_detail(db: Session, article: Article) -> ArticleDetail:
    return ArticleDetail(
        **article_out(article).model_dump(),
        total_quantity=stock.total_quantity(db, article.id),
        locations=stock.locations_for(db, article.id),
    )


def create_article(db: Session, data: ArticleIn, actor: User) -> Article:
    if data.category_id is not None:
        get_active_category(db, data.category_id)
    attributes = validate_attributes(db, data.category_id, data.attributes)
    article = Article(
        name=data.name,
        category_id=data.category_id,
        brand=data.brand,
        mpn=data.mpn,
        description=data.description,
        keywords=data.keywords,
        attributes=attributes,
        min_quantity=data.min_quantity,
        version=1,
    )
    db.add(article)
    db.flush()
    audit(db, "article", article, actor, "create")
    db.commit()
    db.refresh(article)
    return article


def update_article(db: Session, article: Article, data: ArticlePatch, actor: User) -> Article:
    if article.archived_at is not None:
        raise ApiError(404, "not_found", "Article introuvable")
    if data.version != article.version:
        raise conflict_version()
    before = snapshot(article)
    fields = data.model_fields_set

    if "name" in fields:
        if data.name is None:
            raise ApiError(422, "name_required", "Le nom est obligatoire.")
        article.name = data.name
    if "category_id" in fields and data.category_id is not None:
        get_active_category(db, data.category_id)
    category_id = data.category_id if "category_id" in fields else article.category_id
    if "category_id" in fields:
        article.category_id = data.category_id
    for simple in ("brand", "mpn", "description", "keywords", "min_quantity"):
        if simple in fields:
            setattr(article, simple, getattr(data, simple))
    if "attributes" in fields or "category_id" in fields:
        new_attrs = data.attributes if data.attributes is not None else article.attributes
        article.attributes = validate_attributes(db, category_id, new_attrs or {})

    article.version += 1
    article.updated_at = utcnow()
    audit(db, "article", article, actor, "update", before=before)
    db.commit()
    db.refresh(article)
    return article


def archive_article(db: Session, article: Article, actor: User) -> None:
    in_use = db.scalar(
        select(func.count())
        .select_from(Node)
        .where(
            Node.article_id == article.id,
            Node.kind == "item",
            Node.archived_at.is_(None),
            Node.quantity > 0,
        )
    )
    if in_use:
        raise ApiError(409, "article_in_use", "Cet article a encore du stock. Sortez-le d'abord.")
    before = snapshot(article)
    article.archived_at = utcnow()
    article.version += 1
    audit(db, "article", article, actor, "archive", before=before)
    db.commit()


def update_category(db: Session, category_id: uuid.UUID, data: CategoryPatch, actor: User) -> Category:
    category = get_active_category(db, category_id)
    before = snapshot(category)
    category.name = data.name.strip()
    audit(db, "category", category, actor, "update", before=before)
    db.commit()
    db.refresh(category)
    return category


def delete_category(db: Session, category_id: uuid.UUID, actor: User) -> None:
    """Supprime une catégorie (et ses champs) si elle n'a ni sous-catégorie ni article."""
    category = get_active_category(db, category_id)
    if db.scalar(select(func.count()).select_from(Category).where(Category.parent_id == category_id)):
        raise ApiError(409, "category_not_empty", "Cette catégorie a des sous-catégories : supprimez-les d'abord.")
    if db.scalar(
        select(func.count()).select_from(Article).where(Article.category_id == category_id, Article.archived_at.is_(None))
    ):
        raise ApiError(409, "category_in_use", "Des articles utilisent cette catégorie : changez-les d'abord.")
    audit(db, "category", category, actor, "delete")
    db.delete(category)
    db.commit()


def _get_field(db: Session, category_id: uuid.UUID, field_id: uuid.UUID) -> FieldDef:
    field = db.get(FieldDef, field_id)
    if field is None or field.category_id != category_id:
        raise ApiError(404, "not_found", "Champ introuvable")
    return field


def update_field(db: Session, category_id: uuid.UUID, field_id: uuid.UUID, data: FieldDefPatch, actor: User) -> FieldDef:
    field = _get_field(db, category_id, field_id)
    before = snapshot(field)
    fields = data.model_fields_set
    if "label" in fields and data.label is not None:
        field.label = data.label.strip()
    if "unit" in fields:
        if data.unit and field.type != "number":
            raise ApiError(422, "invalid_unit", "L'unité ne concerne que les champs numériques.")
        field.unit = data.unit or None
    if "options" in fields:
        if field.type != "enum":
            raise ApiError(422, "invalid_options", "Les options ne concernent que les champs de type liste.")
        if not data.options:
            raise ApiError(422, "options_required", "Un champ de type liste nécessite des options.")
        field.options = data.options
    if "required" in fields and data.required is not None:
        field.required = data.required
    audit(db, "field_def", field, actor, "update", before=before)
    db.commit()
    db.refresh(field)
    return field


def delete_field(db: Session, category_id: uuid.UUID, field_id: uuid.UUID, actor: User) -> None:
    """Supprime un champ. Les valeurs déjà saisies restent dans les articles mais ne sont plus affichées."""
    field = _get_field(db, category_id, field_id)
    audit(db, "field_def", field, actor, "delete")
    db.delete(field)
    db.commit()


def main_photos(db: Session, article_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    """Photo à afficher pour chaque article : la principale, sinon la plus ancienne."""
    if not article_ids:
        return {}
    rows = db.execute(
        select(Attachment.article_id, Attachment.id)
        .where(Attachment.article_id.in_(article_ids), Attachment.kind == "photo", Attachment.thumb_key.is_not(None))
        .order_by(Attachment.article_id, Attachment.is_main.desc(), Attachment.created_at)
    ).all()
    found: dict[uuid.UUID, uuid.UUID] = {}
    for article_id, attachment_id in rows:
        found.setdefault(article_id, attachment_id)
    return found
