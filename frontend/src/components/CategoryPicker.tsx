import type { Category } from "../types";

/**
 * Choix d'une catégorie par niveaux : Électronique, puis Résistances, etc.
 * Une liste de plus n'apparaît que si la catégorie choisie a des sous-catégories.
 */
export default function CategoryPicker({
  categories,
  value,
  onChange,
  emptyLabel = "Catégorie (facultatif)",
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  emptyLabel?: string;
}) {
  const childrenOf = (parent: string | null) =>
    categories
      .filter((c) => (c.parent_id ?? null) === parent)
      .sort((a, b) => a.name.localeCompare(b.name));

  // Chemin de la valeur choisie, de la racine jusqu'à elle.
  const path: string[] = [];
  let current = value;
  while (current && path.length < 20) {
    path.unshift(current);
    current = categories.find((c) => c.id === current)?.parent_id ?? "";
  }

  // Un niveau par étape : les options du parent, avec la sélection correspondante.
  const levels: { parent: string | null; options: Category[]; selected: string }[] = [];
  let parent: string | null = null;
  for (let i = 0; i < 20; i++) {
    const options = childrenOf(parent);
    if (options.length === 0) break;
    const selected = path[i] ?? "";
    levels.push({ parent, options, selected });
    if (!selected) break;
    parent = selected;
  }

  return (
    <div className="category-picker">
      {levels.map((level, i) => (
        <select
          key={i}
          value={level.selected}
          onChange={(e) => onChange(e.target.value || (level.parent ?? ""))}
          aria-label={i === 0 ? "Catégorie" : "Sous-catégorie"}
        >
          <option value="">{i === 0 ? emptyLabel : "— toutes —"}</option>
          {level.options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
