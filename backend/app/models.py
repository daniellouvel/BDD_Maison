import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

ROLES = ("admin", "membre", "lecture")
NODE_KINDS = ("location", "container", "item")
NODE_TYPE_GENRES = ("emplacement", "contenant", "boite", "tous")
MOVEMENT_KINDS = ("in", "out", "consume", "adjust", "move")
NODE_STATUSES = ("in_stock", "lent", "removed")
ATTACHMENT_KINDS = ("photo", "datasheet", "document", "link", "note")
FIELD_TYPES = ("text", "number", "enum", "bool")


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="ck_users_role"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))


class FieldDef(Base):
    """Champ personnalisé appartenant à une catégorie."""

    __tablename__ = "field_defs"
    __table_args__ = (
        UniqueConstraint("category_id", "key", name="uq_field_defs_category_key"),
        CheckConstraint(_in("type", FIELD_TYPES), name="ck_field_defs_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(16))
    unit: Mapped[str | None] = mapped_column(String(16))
    options: Mapped[list[str] | None] = mapped_column(JSON)
    required: Mapped[bool] = mapped_column(Boolean, default=False)


class Article(Base):
    """Référence ou famille d'articles (ex. « Résistance 10 kΩ 0805 »)."""

    __tablename__ = "articles"
    __table_args__ = (
        Index("ix_articles_name", "name"),
        Index("ix_articles_mpn", "mpn"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str | None] = mapped_column(String(120))
    mpn: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    keywords: Mapped[str | None] = mapped_column(Text)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    min_quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class NodeType(Base):
    """Type d'emplacement ou de contenant défini par l'utilisateur."""

    __tablename__ = "node_types"
    __table_args__ = (CheckConstraint(_in("genre", NODE_TYPE_GENRES), name="ck_node_types_genre"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    # Genre auquel le type s'applique : emplacement, contenant, boîte, ou tous.
    genre: Mapped[str] = mapped_column(String(16), default="tous")


class Node(Base):
    """Élément physique : emplacement, contenant ou objet/lot (kind = item)."""

    __tablename__ = "nodes"
    __table_args__ = (
        Index("uq_nodes_slug", "slug", unique=True),
        CheckConstraint(_in("kind", NODE_KINDS), name="ck_nodes_kind"),
        CheckConstraint(_in("status", NODE_STATUSES), name="ck_nodes_status"),
        CheckConstraint("kind = 'item' OR name IS NOT NULL", name="ck_nodes_name_required"),
        CheckConstraint(
            "(kind = 'item' AND article_id IS NOT NULL AND quantity IS NOT NULL AND quantity >= 0)"
            " OR (kind <> 'item' AND article_id IS NULL AND quantity IS NULL)",
            name="ck_nodes_item_fields",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("nodes.id", ondelete="RESTRICT"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    node_type_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("node_types.id", ondelete="SET NULL")
    )
    name: Mapped[str | None] = mapped_column(String(200))
    article_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("articles.id", ondelete="RESTRICT"), index=True
    )
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    unit: Mapped[str | None] = mapped_column(String(16))
    notes: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    # Plan d'une boîte : étages et cases en millimètres (étages et cases = nœuds enfants).
    layout: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # Nom lisible dans l'adresse (« boite-1 »), unique parmi tous les éléments.
    slug: Mapped[str | None] = mapped_column(String(200))
    # Statut d'un lot : en stock, prêté (à revenir) ou sorti. Ne concerne que les objets.
    status: Mapped[str] = mapped_column(String(16), default="in_stock", server_default="in_stock")


class Loan(Base):
    """Prêt d'un lot : le lot garde son stock, son statut passe à « lent » jusqu'au retour."""

    __tablename__ = "loans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("nodes.id", ondelete="RESTRICT"), index=True)
    recipient: Mapped[str] = mapped_column(String(120))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    out_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    due_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    returned_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Movement(Base):
    """Journal append-only de toute variation de stock ou de position."""

    __tablename__ = "movements"
    __table_args__ = (CheckConstraint(_in("kind", MOVEMENT_KINDS), name="ck_movements_kind"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    op_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)
    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("nodes.id", ondelete="RESTRICT"), index=True)
    article_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("articles.id", ondelete="RESTRICT"), index=True
    )
    delta: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    kind: Mapped[str] = mapped_column(String(16))
    from_node_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("nodes.id", ondelete="RESTRICT"))
    to_node_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("nodes.id", ondelete="RESTRICT"))
    reason: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint(_in("kind", ATTACHMENT_KINDS), name="ck_attachments_kind"),
        CheckConstraint(
            "(article_id IS NOT NULL)::int + (node_id IS NOT NULL)::int = 1",
            name="ck_attachments_single_owner",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    article_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("articles.id", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("nodes.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str | None] = mapped_column(String(200))
    url: Mapped[str | None] = mapped_column(String(2048))
    storage_key: Mapped[str | None] = mapped_column(String(80))
    thumb_key: Mapped[str | None] = mapped_column(String(80))
    mime: Mapped[str | None] = mapped_column(String(100))
    size: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64))
    # Type d'un lien (datasheet, dépôt, notice, fournisseur, autre) ; photo principale d'un propriétaire.
    link_type: Mapped[str | None] = mapped_column(String(24))
    is_main: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


LABEL_STATUSES = ("available", "assigned", "disabled")
LABEL_EVENTS = (
    "created",
    "printed",
    "reprinted",
    "assigned",
    "disabled",
    "replaced",
    "reactivated",
    "released",
)


class QrLabel(Base):
    """Étiquette QR universelle. Le code est permanent ; le type d'élément n'est connu qu'à
    l'affectation. Une étiquette n'existe en base qu'à partir de sa première impression."""

    __tablename__ = "qr_labels"
    __table_args__ = (
        CheckConstraint(_in("status", LABEL_STATUSES), name="ck_qr_labels_status"),
        CheckConstraint(
            "(status = 'assigned') = (assigned_node_id IS NOT NULL)",
            name="ck_qr_labels_assigned_node",
        ),
    )

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, unique=True)
    status: Mapped[str] = mapped_column(String(16), default="available")
    assigned_node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("nodes.id", ondelete="RESTRICT"), unique=True
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text)
    print_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    printed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class QrEvent(Base):
    """Historique complet d'une étiquette (jamais modifié ni supprimé)."""

    __tablename__ = "qr_events"
    __table_args__ = (CheckConstraint(_in("event", LABEL_EVENTS), name="ck_qr_events_event"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(ForeignKey("qr_labels.code", ondelete="RESTRICT"), index=True)
    event: Mapped[str] = mapped_column(String(16))
    node_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("nodes.id", ondelete="SET NULL"))
    sheet_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("print_sheets.id", ondelete="SET NULL")
    )
    detail: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PrintSheet(Base):
    __tablename__ = "print_sheets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    number: Mapped[int] = mapped_column(Integer, Identity(), unique=True)
    is_reprint: Mapped[bool] = mapped_column(Boolean, default=False)
    start_position: Mapped[int] = mapped_column(Integer, default=1)
    label_count: Mapped[int] = mapped_column(Integer)
    layout: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PrintItem(Base):
    __tablename__ = "print_items"

    sheet_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("print_sheets.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(ForeignKey("qr_labels.code", ondelete="RESTRICT"), index=True)
    is_reprint: Mapped[bool] = mapped_column(Boolean, default=False)


class AppSetting(Base):
    """Réglages applicatifs modifiables depuis l'interface (ex. gabarit des planches)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON)


AI_SUGGESTION_STATUSES = ("pending", "accepted", "rejected")


class AiSuggestion(Base):
    """Résultat brut d'une analyse IA. Jamais appliqué sans validation de l'utilisateur."""

    __tablename__ = "ai_suggestions"
    __table_args__ = (
        CheckConstraint(_in("status", AI_SUGGESTION_STATUSES), name="ck_ai_suggestions_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    providers: Mapped[list[str]] = mapped_column(JSON, default=list)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    article_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("articles.id", ondelete="SET NULL")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class ImageEmbedding(Base):
    """Empreinte visuelle d'une photo (vecteur float32 normalisé), pour la recherche par photo."""

    __tablename__ = "image_embeddings"

    attachment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("attachments.id", ondelete="CASCADE"), primary_key=True
    )
    model: Mapped[str] = mapped_column(String(120))
    vector: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    """Historique des modifications de fiches (avant / après)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(16))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SavedView(Base):
    """Recherche enregistrée d'un utilisateur (« résistances », « visserie »…)."""

    __tablename__ = "saved_views"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    query: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


PRICE_SOURCES = ("manual", "order")
PURCHASE_STATUSES = ("to_buy", "ordered", "received", "cancelled")


class Supplier(Base):
    """Fournisseur (site marchand, magasin, particulier)."""

    __tablename__ = "suppliers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class SupplierOffer(Base):
    """Référence d'un article chez un fournisseur. Un seul couple (article, fournisseur)."""

    __tablename__ = "supplier_offers"
    __table_args__ = (UniqueConstraint("article_id", "supplier_id", name="uq_supplier_offers_article_supplier"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    article_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("articles.id", ondelete="RESTRICT"), index=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id", ondelete="RESTRICT"), index=True)
    supplier_ref: Mapped[str | None] = mapped_column(String(120))
    url: Mapped[str | None] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PricePoint(Base):
    """Point de prix observé. Jamais modifié : le prix courant est le plus récent."""

    __tablename__ = "price_points"
    __table_args__ = (
        CheckConstraint(_in("source", PRICE_SOURCES), name="ck_price_points_source"),
        CheckConstraint("unit_price > 0", name="ck_price_points_unit_price_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("supplier_offers.id", ondelete="RESTRICT"), index=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    observed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    source: Mapped[str] = mapped_column(String(16))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class PurchaseItem(Base):
    """Ligne de la liste de courses. N'agit jamais sur le stock : seule la réception crée un objet."""

    __tablename__ = "purchase_items"
    __table_args__ = (
        CheckConstraint(_in("status", PURCHASE_STATUSES), name="ck_purchase_items_status"),
        CheckConstraint("quantity > 0", name="ck_purchase_items_quantity_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    label: Mapped[str] = mapped_column(String(200))
    article_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("articles.id", ondelete="RESTRICT"), index=True)
    offer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("supplier_offers.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    # Prix unitaire indicatif, en euros.
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    status: Mapped[str] = mapped_column(String(16), default="to_buy")
    received_node_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("nodes.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Plan(Base):
    """Modèle de plan réutilisable (armoire, boîte, tiroir…). Affecté à un contenant, il crée
    les étages et les cases ; le plan du contenant est ensuite une copie indépendante."""

    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    width_mm: Mapped[float] = mapped_column(Float)
    height_mm: Mapped[float] = mapped_column(Float)
    # Étages : [{"name": str | None, "cells": [{"name": str | None, "x", "y", "w", "h"}]}]
    levels: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
