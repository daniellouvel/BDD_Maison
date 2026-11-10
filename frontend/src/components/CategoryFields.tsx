import type { FieldDef } from "../types";

export type AttrValue = string | number | boolean;

/** Saisie des champs propres à une catégorie (texte, nombre, liste, oui/non). */
export default function CategoryFields({
  fields,
  values,
  onChange,
}: {
  fields: FieldDef[];
  values: Record<string, AttrValue>;
  onChange: (values: Record<string, AttrValue>) => void;
}) {
  const set = (key: string, value: AttrValue) => onChange({ ...values, [key]: value });

  return (
    <>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.unit ? ` (${f.unit})` : ""}
          {f.required ? " *" : ""}
          {f.type === "enum" ? (
            <select value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
              <option value="">—</option>
              {f.options?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === "bool" ? (
            <input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              step="any"
              required={f.required}
              value={String(values[f.key] ?? "")}
              onChange={(e) => set(f.key, f.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
            />
          )}
        </label>
      ))}
    </>
  );
}
