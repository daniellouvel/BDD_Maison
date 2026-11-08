import datetime as dt
import uuid
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

FieldType = Literal["text", "number", "enum", "bool"]
NodeKind = Literal["location", "container", "item"]
MovementKind = Literal["in", "out", "consume", "adjust", "move"]


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Authentification ---------------------------------------------------------------------------


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class UserOut(_Base):
    id: uuid.UUID
    username: str
    role: str


# --- Catégories et champs ----------------------------------------------------------------------


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None


class CategoryOut(_Base):
    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None


class FieldDefIn(BaseModel):
    key: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=120)
    type: FieldType
    unit: str | None = Field(default=None, max_length=16)
    options: list[str] | None = None
    required: bool = False


class FieldDefOut(_Base):
    id: uuid.UUID
    key: str
    label: str
    type: str
    unit: str | None
    options: list[str] | None
    required: bool


class NodeTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class NodeTypeOut(_Base):
    id: uuid.UUID
    name: str


# --- Articles -----------------------------------------------------------------------------------


class ArticleIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: uuid.UUID | None = None
    brand: str | None = Field(default=None, max_length=120)
    mpn: str | None = Field(default=None, max_length=120)
    description: str | None = None
    keywords: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    min_quantity: Decimal | None = Field(default=None, ge=0)


class ArticlePatch(BaseModel):
    version: int
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category_id: uuid.UUID | None = None
    brand: str | None = Field(default=None, max_length=120)
    mpn: str | None = Field(default=None, max_length=120)
    description: str | None = None
    keywords: str | None = None
    attributes: dict[str, Any] | None = None
    min_quantity: Decimal | None = Field(default=None, ge=0)


class ArticleOut(_Base):
    id: uuid.UUID
    name: str
    category_id: uuid.UUID | None
    brand: str | None
    mpn: str | None
    description: str | None
    keywords: str | None
    attributes: dict[str, Any]
    min_quantity: Decimal | None
    version: int
    updated_at: dt.datetime


class LocationRef(BaseModel):
    node_id: uuid.UUID
    quantity: Decimal
    path: list[str]


class ArticleDetail(ArticleOut):
    total_quantity: Decimal
    locations: list[LocationRef]


# --- Nœuds (emplacements, contenants, objets) ---------------------------------------------------


class NodeIn(BaseModel):
    kind: NodeKind
    parent_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    node_type_id: uuid.UUID | None = None
    article_id: uuid.UUID | None = None
    quantity: Decimal | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=16)
    notes: str | None = None


class NodePatch(BaseModel):
    """Modification d'un nœud. Présence de `parent_id` dans le JSON = déplacement demandé
    (null = racine). Le serveur détecte la présence via `model_fields_set`."""

    version: int
    name: str | None = Field(default=None, min_length=1, max_length=200)
    node_type_id: uuid.UUID | None = None
    notes: str | None = None
    unit: str | None = Field(default=None, max_length=16)
    parent_id: uuid.UUID | None = None


class NodeOut(_Base):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    kind: str
    node_type_id: uuid.UUID | None
    name: str | None
    article_id: uuid.UUID | None
    quantity: Decimal | None
    unit: str | None
    notes: str | None
    version: int
    updated_at: dt.datetime


class BreadcrumbItem(BaseModel):
    id: uuid.UUID
    name: str | None


class NodeDetail(NodeOut):
    breadcrumb: list[BreadcrumbItem]
    children_count: int
    article_name: str | None = None


# --- Stock --------------------------------------------------------------------------------------


class MovementIn(BaseModel):
    op_id: uuid.UUID | None = None
    node_id: uuid.UUID
    kind: MovementKind
    delta: Decimal | None = None
    to_node_id: uuid.UUID | None = None
    reason: str | None = Field(default=None, max_length=500)


class MovementOut(_Base):
    id: uuid.UUID
    node_id: uuid.UUID
    article_id: uuid.UUID
    delta: Decimal
    kind: str
    from_node_id: uuid.UUID | None
    to_node_id: uuid.UUID | None
    reason: str | None
    created_at: dt.datetime


# --- Fichiers -----------------------------------------------------------------------------------


class AttachmentOut(_Base):
    id: uuid.UUID
    article_id: uuid.UUID | None
    node_id: uuid.UUID | None
    kind: str
    title: str | None
    url: str | None
    mime: str | None
    size: int | None
    created_at: dt.datetime


# --- Recherche et tableau de bord ---------------------------------------------------------------


class SearchHit(BaseModel):
    article: ArticleOut
    total_quantity: Decimal
    locations: list[LocationRef]


class DashboardOut(BaseModel):
    articles: int
    containers: int
    locations: int
    items: int
    low_stock: list[ArticleOut]
    unlocated: list[NodeOut]
    recent_movements: list[MovementOut]
