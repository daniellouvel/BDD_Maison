export type Role = "admin" | "membre" | "lecture";

export interface User {
  id: string;
  username: string;
  role: Role;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface FieldDef {
  id: string;
  key: string;
  label: string;
  type: "text" | "number" | "enum" | "bool";
  unit: string | null;
  options: string[] | null;
  required: boolean;
}

export interface NodeType {
  id: string;
  name: string;
  /** À quel genre le type s'applique : emplacement, contenant, boîte, ou tous. */
  genre: "emplacement" | "contenant" | "boite" | "tous";
}

export interface Article {
  id: string;
  name: string;
  category_id: string | null;
  brand: string | null;
  mpn: string | null;
  description: string | null;
  keywords: string | null;
  attributes: Record<string, string | number | boolean>;
  min_quantity: string | null;
  version: number;
  updated_at: string;
}

export interface LocationRef {
  node_id: string;
  quantity: string;
  path: string[];
}

export interface ArticleDetail extends Article {
  total_quantity: string;
  locations: LocationRef[];
}

export type NodeKind = "location" | "container" | "item";

export interface Node {
  id: string;
  parent_id: string | null;
  kind: NodeKind;
  node_type_id: string | null;
  name: string | null;
  article_id: string | null;
  quantity: string | null;
  unit: string | null;
  notes: string | null;
  version: number;
  updated_at: string;
  /** Adresse lisible (ex. « boite-1 »), utilisée dans l'URL. */
  slug?: string | null;
}

export interface NodeDetail extends Node {
  breadcrumb: { id: string; name: string | null }[];
  children_count: number;
  article_name: string | null;
  qr_code: string | null;
  archived: boolean;
  layout?: BoxLayout | null;
}

/** Case d'un étage : rectangle en millimètres dans le plan de la boîte, élément enfant de l'étage. */
export interface BoxCell {
  node_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Étage d'une boîte. node_id = null : bloc sans étage, les cases sont directement dans la boîte. */
export interface BoxLevel {
  node_id: string | null;
  cells: BoxCell[];
}

export interface BoxLayout {
  width_mm: number;
  height_mm: number;
  levels: BoxLevel[];
}

export type LabelStatus = "available" | "assigned" | "disabled";

export interface LabelEvent {
  event: "created" | "printed" | "reprinted" | "assigned" | "disabled" | "replaced" | "reactivated";
  node_id: string | null;
  sheet_id: string | null;
  detail: string | null;
  at: string;
}

export interface Label {
  code: string;
  seq: number;
  status: LabelStatus;
  disabled_reason: string | null;
  print_count: number;
  printed_at: string | null;
  payload: string;
  node: NodeDetail | null;
  events: LabelEvent[];
}

export interface QrStats {
  available: number;
  assigned: number;
  disabled: number;
  total: number;
  next_code: string;
  sheets: number;
  public_url: string;
}

export interface LabelLayout {
  page_width: number;
  page_height: number;
  columns: number;
  rows: number;
  margin_left: number;
  margin_top: number;
  label_width: number;
  label_height: number;
  pitch_x: number;
  pitch_y: number;
  qr_size: number;
  font_size: number;
  draw_borders: boolean;
}

export interface Sheet {
  id: string;
  number: number;
  is_reprint: boolean;
  start_position: number;
  label_count: number;
  created_at: string;
  first_code: string | null;
  last_code: string | null;
}

export interface SheetPreview {
  codes: string[];
  start_position: number;
  capacity: number;
  already_printed: { code: string; status: LabelStatus; print_count: number; printed_at: string | null }[];
  requires_confirmation: boolean;
}

export interface Movement {
  id: string;
  node_id: string;
  article_id: string;
  delta: string;
  kind: "in" | "out" | "consume" | "adjust" | "move";
  reason: string | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  kind: "photo" | "datasheet" | "document" | "link" | "note";
  title: string | null;
  url: string | null;
  mime: string | null;
  /** Type d'un lien : datasheet, depot, notice, fournisseur, autre. */
  link_type?: string | null;
  /** Photo principale de l'article. */
  is_main?: boolean;
  created_at: string;
}

export interface SearchHit {
  article: Article;
  total_quantity: string;
  locations: LocationRef[];
}

export interface Dashboard {
  articles: number;
  containers: number;
  locations: number;
  items: number;
  labels_available: number;
  labels_assigned: number;
  low_stock: Article[];
  unlocated: NodeDetail[];
  recent_movements: Movement[];
}

// --- IA (phase 4) ---

export interface AiStatus {
  ocr: boolean;
  embeddings: boolean;
  remote_configured: boolean;
  remote_enabled: boolean;
  remote_host: string | null;
}

export interface Identification {
  name: string | null;
  category: string | null;
  category_id: string | null;
  brand: string | null;
  mpn: string | null;
  description: string | null;
  keywords: string[];
  confidence: number | null;
}

export interface PartReference {
  reference: string;
  datasheet_url: string;
  matches: Article[];
}

export interface SimilarHit {
  article: Article;
  score: number;
  attachment_id: string;
}

export interface Analysis {
  suggestion_id: string;
  ocr_text: string | null;
  parts: PartReference[];
  identification: Identification | null;
  similar: SimilarHit[];
  warnings: string[];
}

/** Case d'un modèle de plan : rectangle en millimètres, nom facultatif. */
export interface PlanCell {
  name: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlanLevel {
  name: string | null;
  cells: PlanCell[];
  /** true : bloc sans étage, les cases sont directement dans le contenant. */
  base?: boolean;
}

/** Modèle de plan réutilisable (armoire, boîte, tiroir) : affecté à un contenant, il en copie la grille. */
export interface PlanModel {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  levels: PlanLevel[];
  version: number;
}
