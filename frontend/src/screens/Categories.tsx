import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { Category, FieldDef } from "../types";

/**
 * Catégories et champs associés. Un champ appartient à une catégorie et est hérité par ses
 * sous-catégories (ex. « Résistances » → champ « Valeur » en Ω).
 */

const TYPE_LABEL: Record<FieldDef["type"], string> = {
  text: "Texte",
  number: "Nombre",
  enum: "Liste de choix",
  bool: "Oui / Non",
};

/** « Valeur max (V) » → « valeur_max_v » : clé technique du champ, sans accents ni espaces. */
function keyFromLabel(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(base) ? base.slice(0, 64) : `c_${base}`.slice(0, 64);
}

export default function Categories() {
  const { canWrite } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCategories(await api.get<Category[]>("/categories"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Arbre à plat : chaque catégorie sous son parent, avec sa profondeur.
  const rows: { cat: Category; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    categories
      .filter((c) => c.parent_id === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((c) => {
        rows.push({ cat: c, depth });
        walk(c.id, depth + 1);
      });
  };
  walk(null, 0);

  return (
    <div className="explorer">
      <h1>Catégories</h1>
      {error && <p className="error">{error}</p>}
      <div className="explorer-body">
        <aside className="explorer-tree card">
          {canWrite && <AddCategory categories={categories} onDone={(id) => { load(); if (id) setSelected(id); }} />}
          {rows.length === 0 && <p className="muted small">Aucune catégorie. Ajoutez la première ci-dessus.</p>}
          <ul className="org-list">
            {rows.map(({ cat, depth }) => (
              <li key={cat.id}>
                <div
                  className={`org-row${selected === cat.id ? " org-selected" : ""}`}
                  style={{ paddingLeft: `${depth * 1.1 + 0.4}rem` }}
                >
                  <button type="button" className="org-name" onClick={() => setSelected(cat.id)}>
                    📁 {cat.name}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
        <section className="explorer-detail card">
          {selected && categories.some((c) => c.id === selected) ? (
            <CategoryPanel
              key={selected}
              id={selected}
              categories={categories}
              canWrite={canWrite}
              onChanged={load}
              onDeleted={() => {
                setSelected(null);
                load();
              }}
              onSelect={setSelected}
            />
          ) : (
            <p className="muted">Choisissez une catégorie pour voir et modifier ses champs.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function AddCategory({ categories, onDone }: { categories: Category[]; onDone: (createdId: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Donnez un nom.");
    setError(null);
    try {
      const created = await api.post<Category>("/categories", { name: name.trim(), parent_id: parent || null });
      setName("");
      setOpen(false);
      onDone(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    }
  }

  if (!open) {
    return (
      <button type="button" className="root-add" onClick={() => setOpen(true)}>
        + Ajouter une catégorie
      </button>
    );
  }
  return (
    <form className="form detail-card" onSubmit={submit}>
      <input placeholder="Nom (ex. Résistances)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <select value={parent} onChange={(e) => setParent(e.target.value)}>
        <option value="">Catégorie principale</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            Sous-catégorie de « {c.name} »
          </option>
        ))}
      </select>
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button type="submit">Ajouter</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function CategoryPanel({
  id,
  categories,
  canWrite,
  onChanged,
  onDeleted,
  onSelect,
}: {
  id: string;
  categories: Category[];
  canWrite: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  onSelect: (id: string) => void;
}) {
  const cat = categories.find((c) => c.id === id)!;
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [inherited, setInherited] = useState<{ from: string; fields: FieldDef[] }[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(cat.name);
  const [error, setError] = useState<string | null>(null);

  // Ancêtres, du plus proche au plus lointain : leurs champs sont hérités.
  const ancestors: Category[] = [];
  for (let p = categories.find((c) => c.id === cat.parent_id); p; p = categories.find((c) => c.id === p!.parent_id)) {
    ancestors.push(p);
  }
  const ancestorKey = ancestors.map((a) => a.id).join(",");

  const load = useCallback(async () => {
    try {
      setFields(await api.get<FieldDef[]>(`/categories/${id}/fields`));
      const list = await Promise.all(
        ancestorKey
          ? ancestorKey.split(",").map(async (aid) => ({
              from: categories.find((c) => c.id === aid)?.name ?? "",
              fields: await api.get<FieldDef[]>(`/categories/${aid}/fields`),
            }))
          : [],
      );
      setInherited(list.filter((x) => x.fields.length > 0));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ancestorKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : message);
      return false;
    }
    return true;
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await run(() => api.patch(`/categories/${id}`, { name: name.trim() }), "Renommage impossible.")) {
      setRenaming(false);
      onChanged();
    }
  }

  async function remove() {
    if (!window.confirm(`Supprimer la catégorie « ${cat.name} » et ses champs ?\n\nLes valeurs déjà saisies restent dans les articles mais ne seront plus affichées.`)) return;
    if (await run(() => api.del(`/categories/${id}`), "Suppression impossible.")) onDeleted();
  }

  async function removeField(f: FieldDef) {
    if (!window.confirm(`Supprimer le champ « ${f.label} » ?`)) return;
    if (await run(() => api.del(`/categories/${id}/fields/${f.id}`), "Suppression impossible.")) load();
  }

  const children = categories.filter((c) => c.parent_id === id);

  return (
    <>
      {ancestors.length > 0 && (
        <p className="muted small path-line">
          {[...ancestors].reverse().map((a) => (
            <span key={a.id}>
              <button type="button" className="linklike" onClick={() => onSelect(a.id)}>
                {a.name}
              </button>
              {" › "}
            </span>
          ))}
          {cat.name}
        </p>
      )}
      {renaming ? (
        <form className="row" onSubmit={rename}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="submit">Enregistrer</button>
          <button type="button" className="secondary" onClick={() => setRenaming(false)}>
            Annuler
          </button>
        </form>
      ) : (
        <h2>📁 {cat.name}</h2>
      )}
      {canWrite && !renaming && (
        <div className="row">
          <button type="button" className="secondary" onClick={() => setRenaming(true)}>
            Renommer
          </button>
          <button type="button" className="secondary danger" onClick={remove}>
            Supprimer
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <section className="detail-card">
        <h3>Champs de cette catégorie ({fields.length})</h3>
        {fields.length === 0 && <p className="muted small">Aucun champ propre. Ajoutez-en ci-dessous.</p>}
        <ul className="list">
          {fields.map((f) => (
            <FieldRow key={f.id} categoryId={id} field={f} canWrite={canWrite} onSaved={load} onDelete={() => removeField(f)} />
          ))}
        </ul>
        {canWrite && <AddField categoryId={id} onDone={load} />}
      </section>

      {inherited.length > 0 && (
        <section className="detail-card">
          <h3>Champs hérités</h3>
          {inherited.map((g) => (
            <div key={g.from}>
              <p className="muted small">De « {g.from} »</p>
              <ul className="list">
                {g.fields.map((f) => (
                  <li key={f.id}>
                    {f.label} <span className="muted small">· {TYPE_LABEL[f.type]}{f.unit ? ` (${f.unit})` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {children.length > 0 && (
        <section className="detail-card">
          <h3>Sous-catégories</h3>
          <ul className="list">
            {children.map((c) => (
              <li key={c.id}>
                <button type="button" className="linklike" onClick={() => onSelect(c.id)}>
                  📁 {c.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function FieldRow({
  categoryId,
  field,
  canWrite,
  onSaved,
  onDelete,
}: {
  categoryId: string;
  field: FieldDef;
  canWrite: boolean;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(field.label);
  const [unit, setUnit] = useState(field.unit ?? "");
  const [options, setOptions] = useState((field.options ?? []).join(", "));
  const [required, setRequired] = useState(field.required);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { label: label.trim(), required };
    if (field.type === "number") body.unit = unit.trim() || null;
    if (field.type === "enum") body.options = options.split(",").map((o) => o.trim()).filter(Boolean);
    try {
      await api.patch(`/categories/${categoryId}/fields/${field.id}`, body);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Modification impossible.");
    }
  }

  if (open) {
    return (
      <li>
        <form className="form" onSubmit={save}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
          {field.type === "number" && <input placeholder="Unité (Ω, V, mm…)" value={unit} onChange={(e) => setUnit(e.target.value)} />}
          {field.type === "enum" && (
            <input placeholder="Choix séparés par des virgules" value={options} onChange={(e) => setOptions(e.target.value)} />
          )}
          <label className="checkbox">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Obligatoire
          </label>
          {error && <p className="error small">{error}</p>}
          <div className="row">
            <button type="submit">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li>
      <strong>{field.label}</strong>{" "}
      <span className="muted small">
        · {TYPE_LABEL[field.type]}
        {field.unit ? ` (${field.unit})` : ""}
        {field.type === "enum" && field.options ? ` : ${field.options.join(", ")}` : ""}
        {field.required ? " · obligatoire" : ""}
      </span>
      {canWrite && (
        <>
          {" "}
          <button type="button" className="linklike" onClick={() => setOpen(true)}>
            Modifier
          </button>{" "}
          <button type="button" className="linklike danger" onClick={onDelete}>
            Supprimer
          </button>
        </>
      )}
    </li>
  );
}

function AddField({ categoryId, onDone }: { categoryId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldDef["type"]>("text");
  const [unit, setUnit] = useState("");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return setError("Donnez un nom au champ.");
    setError(null);
    try {
      await api.post(`/categories/${categoryId}/fields`, {
        key: keyFromLabel(label),
        label: label.trim(),
        type,
        unit: type === "number" && unit.trim() ? unit.trim() : null,
        options: type === "enum" ? options.split(",").map((o) => o.trim()).filter(Boolean) : null,
        required,
      });
      setLabel("");
      setUnit("");
      setOptions("");
      setRequired(false);
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ajout impossible.");
    }
  }

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        + Ajouter un champ
      </button>
    );
  }
  return (
    <form className="form" onSubmit={submit}>
      <input placeholder="Nom du champ (ex. Valeur, Boîtier, Tension max)" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      <select value={type} onChange={(e) => setType(e.target.value as FieldDef["type"])}>
        {(Object.keys(TYPE_LABEL) as FieldDef["type"][]).map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      {type === "number" && <input placeholder="Unité (Ω, V, mm…) — facultatif" value={unit} onChange={(e) => setUnit(e.target.value)} />}
      {type === "enum" && (
        <input placeholder="Choix séparés par des virgules (ex. 0603, 0805, 1206)" value={options} onChange={(e) => setOptions(e.target.value)} />
      )}
      <label className="checkbox">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Obligatoire
      </label>
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button type="submit">Ajouter le champ</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}
