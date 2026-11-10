import { api } from "./api";
import type { Category, FieldDef } from "./types";

/** Champs personnalisés d'une catégorie et de ses ancêtres, comme le fait le serveur. */
export async function inheritedFields(categories: Category[], categoryId: string | null): Promise<FieldDef[]> {
  const chain: string[] = [];
  let current = categoryId;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = categories.find((c) => c.id === current)?.parent_id ?? null;
  }
  const byKey = new Map<string, FieldDef>();
  for (const id of chain.reverse()) {
    for (const f of await api.get<FieldDef[]>(`/categories/${id}/fields`)) byKey.set(f.key, f);
  }
  return [...byKey.values()];
}

export function categoryLabel(categories: Category[], id: string): string {
  const names: string[] = [];
  let current: string | null = id;
  while (current && names.length < 20) {
    const cat = categories.find((c) => c.id === current);
    if (!cat) break;
    names.unshift(cat.name);
    current = cat.parent_id;
  }
  return names.join(" › ");
}

/** Valeur lisible pour un nom : 4700 Ω → « 4,7 kΩ », 0,1 µF → « 100 nF », 220 Ω → « 220 Ω ». */
export function formatValue(value: number, unit: string): string {
  const fr = (n: number) => String(Number(n.toPrecision(3))).replace(".", ",");
  if (unit === "Ω") {
    if (value >= 1_000_000) return `${fr(value / 1_000_000)} MΩ`;
    if (value >= 1_000) return `${fr(value / 1_000)} kΩ`;
    return `${fr(value)} Ω`;
  }
  if (unit === "µF") {
    if (value < 1) return `${fr(value * 1000)} nF`;
    return `${fr(value)} µF`;
  }
  return `${fr(value)} ${unit}`.trim();
}

/** Champ qui donne la valeur principale d'un composant (ex. la résistance en Ω, la capacité en µF). */
const VALUE_FIELDS: Record<string, string> = { valeur: "Ω", capacite: "µF" };

/**
 * Ajoute la valeur au nom si elle n'y figure pas déjà (« Résistance » + 4700 Ω → « Résistance 4,7 kΩ »).
 * Ne change rien si le nom contient déjà une valeur ou si le champ n'est pas renseigné.
 */
export function nameWithValue(name: string, fields: FieldDef[], attributes: Record<string, unknown>): string {
  const field = fields.find((f) => VALUE_FIELDS[f.key] === f.unit && f.type === "number");
  if (!field) return name;
  const raw = attributes[field.key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return name;
  const label = formatValue(raw, field.unit ?? "");
  const compact = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(",", ".");
  if (compact(name).includes(compact(label))) return name;
  return `${name.trim()} ${label}`;
}
