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
}

export interface NodeDetail extends Node {
  breadcrumb: { id: string; name: string | null }[];
  children_count: number;
  article_name: string | null;
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
  low_stock: Article[];
  unlocated: Node[];
  recent_movements: Movement[];
}
