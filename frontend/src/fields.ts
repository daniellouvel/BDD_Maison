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
