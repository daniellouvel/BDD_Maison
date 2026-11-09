import datetime as dt
import uuid
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    slug: str | None = None


class BreadcrumbItem(BaseModel):
    id: uuid.UUID
    name: str | None


class NodeDetail(NodeOut):
    breadcrumb: list[BreadcrumbItem]
    children_count: int
    article_name: str | None = None
    qr_code: str | None = None
    archived: bool = False
    layout: dict | None = None


class LayoutCellIn(BaseModel):
    """Case d'un étage : rectangle en millimètres dans le plan de la boîte, et élément enfant de l'étage."""

    node_id: uuid.UUID
    x: float = Field(ge=0, le=5000)
    y: float = Field(ge=0, le=5000)
    w: float = Field(gt=0, le=5000)
    h: float = Field(gt=0, le=5000)


class LayoutLevelIn(BaseModel):
    """Étage d'une boîte : élément enfant de la boîte, avec ses cases."""

    node_id: uuid.UUID
    cells: list[LayoutCellIn] = Field(default_factory=list, max_length=500)


class LayoutIn(BaseModel):
    version: int
    width_mm: float = Field(gt=0, le=5000)
    height_mm: float = Field(gt=0, le=5000)
    levels: list[LayoutLevelIn] = Field(default_factory=list, max_length=20)


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


# --- Étiquettes QR ------------------------------------------------------------------------------

PT_TO_MM = 0.3528


class LabelLayout(BaseModel):
    """Gabarit d'une planche d'étiquettes (mm). Valeurs par défaut : planche A4 de 65 étiquettes
    38,1 × 21,2 mm (format courant, type L7651). À calibrer avec une planche d'essai."""

    page_width: float = Field(default=210.0, gt=0, le=500)
    page_height: float = Field(default=297.0, gt=0, le=500)
    columns: int = Field(default=5, ge=1, le=20)
    rows: int = Field(default=13, ge=1, le=40)
    margin_left: float = Field(default=4.7, ge=0)
    margin_top: float = Field(default=10.7, ge=0)
    label_width: float = Field(default=38.1, gt=0)
    label_height: float = Field(default=21.2, gt=0)
    pitch_x: float = Field(default=40.6, gt=0)
    pitch_y: float = Field(default=21.2, gt=0)
    qr_size: float = Field(default=15.0, gt=3)
    font_size: float = Field(default=7.0, ge=4, le=20)
    draw_borders: bool = False

    @model_validator(mode="after")
    def _fits(self) -> "LabelLayout":
        eps = 0.01
        if self.pitch_x + eps < self.label_width or self.pitch_y + eps < self.label_height:
            raise ValueError("Le pas doit être au moins égal à la taille d'une étiquette.")
        right = self.margin_left + (self.columns - 1) * self.pitch_x + self.label_width
        bottom = self.margin_top + (self.rows - 1) * self.pitch_y + self.label_height
        if right > self.page_width + eps or bottom > self.page_height + eps:
            raise ValueError("Les étiquettes dépassent de la page avec ces dimensions.")
        if self.qr_size > self.label_width or self.qr_size + self.font_size * PT_TO_MM + 1 > self.label_height:
            raise ValueError("Le QR code et son numéro ne tiennent pas dans l'étiquette.")
        return self

    @property
    def capacity(self) -> int:
        return self.columns * self.rows


class SheetRequest(BaseModel):
    """`next` : nouveaux codes, suite de la séquence. `range` : réimpression de codes existants."""

    mode: Literal["next", "range"] = "next"
    count: int | None = Field(default=None, ge=1, le=800)
    start_seq: int | None = Field(default=None, ge=1, le=999_999)
    start_position: int = Field(default=1, ge=1)
    confirm_reprint: bool = False


class LabelConflict(BaseModel):
    code: str
    status: str
    print_count: int
    printed_at: dt.datetime | None


class SheetPreview(BaseModel):
    codes: list[str]
    start_position: int
    capacity: int
    already_printed: list[LabelConflict]
    requires_confirmation: bool


class SheetOut(_Base):
    id: uuid.UUID
    number: int
    is_reprint: bool
    start_position: int
    label_count: int
    created_at: dt.datetime
    first_code: str | None = None
    last_code: str | None = None


class LabelEventOut(_Base):
    event: str
    node_id: uuid.UUID | None
    sheet_id: uuid.UUID | None
    detail: str | None
    at: dt.datetime


class LabelOut(BaseModel):
    code: str
    seq: int
    status: str
    disabled_reason: str | None
    print_count: int
    printed_at: dt.datetime | None
    payload: str
    node: NodeDetail | None
    events: list[LabelEventOut]


class AssignIn(BaseModel):
    node_id: uuid.UUID


class DisableIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


class ReplaceIn(BaseModel):
    new_code: str = Field(min_length=1, max_length=200)


class QrStats(BaseModel):
    available: int
    assigned: int
    disabled: int
    total: int
    next_code: str
    sheets: int
    public_url: str


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
    labels_available: int
    labels_assigned: int
    low_stock: list[ArticleOut]
    unlocated: list[NodeDetail]
    recent_movements: list[MovementOut]


# --- IA (phase 4) ---------------------------------------------------------------------------------


class AiStatus(BaseModel):
    ocr: bool
    embeddings: bool
    remote_configured: bool
    remote_enabled: bool
    remote_host: str | None


class AiSettingsIn(BaseModel):
    remote_enabled: bool


class IdentificationOut(BaseModel):
    name: str | None = None
    category: str | None = None
    category_id: uuid.UUID | None = None
    brand: str | None = None
    mpn: str | None = None
    description: str | None = None
    keywords: list[str] = []
    confidence: float | None = None


class PartReference(BaseModel):
    """Référence repérée dans le texte lu (ex. marquage d'un composant)."""

    reference: str
    datasheet_url: str
    matches: list[ArticleOut]


class SimilarHit(BaseModel):
    article: ArticleOut
    score: float
    attachment_id: uuid.UUID


class AnalysisOut(BaseModel):
    suggestion_id: uuid.UUID
    ocr_text: str | None = None
    parts: list[PartReference] = []
    identification: IdentificationOut | None = None
    similar: list[SimilarHit] = []
    # Fonctions demandées mais indisponibles (Tesseract absent, quota dépassé…), messages en français.
    warnings: list[str] = []


class SuggestionDecision(BaseModel):
    status: Literal["accepted", "rejected"]
    article_id: uuid.UUID | None = None
