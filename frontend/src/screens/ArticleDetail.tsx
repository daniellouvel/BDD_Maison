import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, fileUrl, formatQty, thumbUrl } from "../api";
import { useAuth } from "../auth";
import MovementForm from "../components/MovementForm";
import SimilarList from "../components/SimilarList";
import { categoryLabel, inheritedFields } from "../fields";
import type { ArticleDetail, Attachment, Category, FieldDef, SimilarHit } from "../types";

const LINK_TYPES = [
  { value: "datasheet", label: "Datasheet" },
  { value: "depot", label: "Dépôt (GitHub…)" },
  { value: "notice", label: "Notice" },
  { value: "fournisseur", label: "Fournisseur" },
  { value: "autre", label: "Autre" },
];
const linkLabel = (v: string | null | undefined) => LINK_TYPES.find((t) => t.value === v)?.label ?? "Lien";

/** Parties de la fiche que l'on peut masquer (réglage gardé sur cet appareil). */
const SECTIONS = [
  { key: "infos", label: "Informations (catégorie, marque, référence, stock, seuil)" },
  { key: "photos", label: "Photos" },
  { key: "description", label: "Description" },
  { key: "champs", label: "Champs de la catégorie" },
  { key: "motscles", label: "Mots-clés" },
  { key: "liens", label: "Liens" },
  { key: "documents", label: "Documents (PDF)" },
  { key: "stock", label: "Stock par emplacement" },
  { key: "similaires", label: "Objets ressemblants" },
];
const HIDDEN_KEY = "fiche-masques";

function readHidden(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export default function ArticleDetailScreen({ articleId }: { articleId?: string } = {}) {
  const params = useParams();
  const id = articleId ?? params.id;
  const { canWrite } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [openMovement, setOpenMovement] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarHit[]>([]);
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [configOpen, setConfigOpen] = useState(false);

  const show = (key: string) => !hidden.includes(key);
  function setVisible(key: string, visible: boolean) {
    const next = visible ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      /* le réglage reste valable jusqu'au rechargement */
    }
  }

  const load = useCallback(async () => {
    try {
      const [a, files, cats] = await Promise.all([
        api.get<ArticleDetail>(`/articles/${id}`),
        api.get<Attachment[]>(`/attachments?article_id=${id}`),
        api.get<Category[]>("/categories"),
      ]);
      setArticle(a);
      setAttachments(files);
      setCategories(cats);
      setFields(await inheritedFields(cats, a.category_id));
      // Empreintes déjà calculées : réponse rapide, et liste vide si l'IA est absente.
      api.get<SimilarHit[]>(`/articles/${id}/similar`).then(setSimilar).catch(() => setSimilar([]));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : message);
    }
  }

  const addLink = (title: string, url: string, linkType: string) =>
    run(async () => {
      const form = new FormData();
      form.append("kind", "link");
      form.append("article_id", article!.id);
      form.append("url", url.trim());
      if (title.trim()) form.append("title", title.trim());
      if (linkType) form.append("link_type", linkType);
      await api.post("/attachments", form);
    }, "Ajout du lien impossible.");

  const upload = (kind: "photo" | "datasheet", file: File | undefined) =>
    !file || !article
      ? Promise.resolve()
      : run(async () => {
          const form = new FormData();
          form.append("kind", kind);
          form.append("article_id", article.id);
          form.append("title", file.name);
          form.append("file", file);
          await api.post("/attachments", form);
        }, "Envoi impossible.");

  const patchAttachment = (attId: string, body: Record<string, unknown>) =>
    run(() => api.patch(`/attachments/${attId}`, body), "Modification impossible.");

  const removeAttachment = (att: Attachment) => {
    if (!window.confirm(`Supprimer « ${att.title ?? "ce fichier"} » ? Cette action est définitive.`)) return Promise.resolve();
    return run(() => api.del(`/attachments/${att.id}`), "Suppression impossible.");
  };

  /** Remplacer une photo : la nouvelle prend sa place (principale si l'ancienne l'était), l'ancienne est supprimée. */
  const replacePhoto = (old: Attachment, file: File | undefined) =>
    !file || !article
      ? Promise.resolve()
      : run(async () => {
          const form = new FormData();
          form.append("kind", "photo");
          form.append("article_id", article.id);
          form.append("title", file.name);
          form.append("file", file);
          const created = await api.post<Attachment>("/attachments", form);
          if (old.is_main) await api.patch(`/attachments/${created.id}`, { is_main: true });
          await api.del(`/attachments/${old.id}`);
        }, "Remplacement impossible.");

  if (error && !article) return <p className="error">{error}</p>;
  if (!article) return <p className="muted">Chargement…</p>;

  const photos = attachments.filter((a) => a.kind === "photo");
  const links = attachments.filter((a) => a.kind === "link");
  const docs = attachments.filter((a) => a.kind !== "photo" && a.kind !== "link");
  const edit = canWrite && editing;

  return (
    <>
      <section className="card">
        <h1>{article.name}</h1>
        {show("infos") && (
          <dl className="attrs">
            {article.category_id && (
              <div>
                <dt>Catégorie</dt>
                <dd>{categoryLabel(categories, article.category_id)}</dd>
              </div>
            )}
            {article.brand && (
              <div>
                <dt>Marque</dt>
                <dd>{article.brand}</dd>
              </div>
            )}
            {article.mpn && (
              <div>
                <dt>Référence fabricant</dt>
                <dd>{article.mpn}</dd>
              </div>
            )}
            <div>
              <dt>Stock total</dt>
              <dd>{formatQty(article.total_quantity)}</dd>
            </div>
            {article.min_quantity && (
              <div>
                <dt>Seuil d'alerte</dt>
                <dd>{formatQty(article.min_quantity)}</dd>
              </div>
            )}
          </dl>
        )}
        {show("photos") && (photos.length > 0 || edit) && (
          <div className="photos">
            <div className="gallery">
              {photos.map((p) => (
                <div key={p.id} className="photo-item">
                  <a href={fileUrl(p.id)} target="_blank" rel="noreferrer">
                    <img src={thumbUrl(p.id)} alt={p.title ?? article.name} loading="lazy" />
                  </a>
                  {p.is_main && photos.length > 1 && <span className="ribbon">principale</span>}
                  {edit && (
                    <div className="photo-actions">
                      {!p.is_main && (
                        <button type="button" className="linklike" onClick={() => patchAttachment(p.id, { is_main: true })}>
                          Principale
                        </button>
                      )}
                      <label className="linklike">
                        Remplacer
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => {
                            replacePhoto(p, e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button type="button" className="linklike danger" onClick={() => removeAttachment(p)}>
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {edit && (
              <label className="filebutton">
                Ajouter une photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    upload("photo", e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        )}
        {show("description") && article.description && (
          <p>
            <strong>Description : </strong>
            {article.description}
          </p>
        )}
        {show("champs") && fields.length > 0 && (
          <dl className="attrs">
            {fields
              .filter((f) => article.attributes[f.key] !== undefined)
              .map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {typeof article.attributes[f.key] === "boolean"
                      ? article.attributes[f.key]
                        ? "Oui"
                        : "Non"
                      : String(article.attributes[f.key])}
                    {f.unit ? ` ${f.unit}` : ""}
                  </dd>
                </div>
              ))}
          </dl>
        )}
        {show("motscles") && article.keywords && <p className="muted small">Mots-clés : {article.keywords}</p>}
        {canWrite && (
          <button type="button" className="linklike" onClick={() => setEditing(!editing)}>
            {editing ? "Fermer la modification" : "Modifier la fiche"}
          </button>
        )}
        {editing && (
          <ArticleEdit
            article={article}
            categories={categories}
            onSaved={() => {
              setEditing(false);
              load();
            }}
          />
        )}
      </section>

      {show("liens") && (links.length > 0 || edit) && (
        <section className="card">
          <h2>Liens</h2>
          {links.length === 0 && <p className="muted small">Aucun lien.</p>}
          <ul className="list">
            {links.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                editable={edit}
                onSave={(body) => patchAttachment(l.id, body)}
                onDelete={() => removeAttachment(l)}
              />
            ))}
          </ul>
          {edit && <LinkForm onAdd={addLink} />}
        </section>
      )}

      {show("documents") && (docs.length > 0 || edit) && (
        <section className="card">
          <h2>Documents</h2>
          {docs.length === 0 && <p className="muted small">Aucun document.</p>}
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id}>
                <a href={fileUrl(d.id)} target="_blank" rel="noreferrer">
                  {d.title ?? d.kind}
                </a>
                {edit && (
                  <button type="button" className="linklike danger" onClick={() => removeAttachment(d)}>
                    Supprimer
                  </button>
                )}
              </li>
            ))}
          </ul>
          {edit && (
            <label className="filebutton">
              Ajouter une datasheet (PDF)
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  upload("datasheet", e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}

      {show("stock") && (
        <section className="card">
          <h2>Stock total : {formatQty(article.total_quantity)}</h2>
          {article.min_quantity && <p className="muted small">Alerte sous {formatQty(article.min_quantity)}</p>}
          {article.locations.length === 0 && <p className="muted">Aucun lot enregistré.</p>}
          <ul className="list">
            {article.locations.map((loc) => (
              <li key={loc.node_id}>
                <Link to={`/nodes/${loc.node_id}`}>{loc.path.length ? loc.path.join(" › ") : "Non localisé"}</Link>
                <strong> × {formatQty(loc.quantity)}</strong>
                {canWrite && (
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => setOpenMovement(openMovement === loc.node_id ? null : loc.node_id)}
                  >
                    Mouvement
                  </button>
                )}
                {openMovement === loc.node_id && (
                  <MovementForm
                    nodeId={loc.node_id}
                    onDone={() => {
                      setOpenMovement(null);
                      load();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {show("similaires") && similar.length > 0 && (
        <section className="card">
          <h2>Objets ressemblants</h2>
          <SimilarList hits={similar} />
        </section>
      )}

      <section className="display-config">
        <button type="button" className="linklike" onClick={() => setConfigOpen(!configOpen)}>
          ⚙ Configurer l'affichage
        </button>
        {configOpen && (
          <div className="card">
            <p className="muted small">Choisissez les parties à afficher sur la fiche (réglage de cet appareil).</p>
            {SECTIONS.map((s) => (
              <label key={s.key} className="checkbox">
                <input type="checkbox" checked={show(s.key)} onChange={(e) => setVisible(s.key, e.target.checked)} />
                {s.label}
              </label>
            ))}
            <button type="button" className="secondary" onClick={() => SECTIONS.forEach((s) => setVisible(s.key, true))}>
              Tout afficher
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/** Un lien de la fiche : type, titre cliquable ; en modification, on peut le corriger ou le supprimer. */
function LinkRow({
  link,
  editable,
  onSave,
  onDelete,
}: {
  link: Attachment;
  editable: boolean;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(link.title ?? "");
  const [url, setUrl] = useState(link.url ?? "");
  const [type, setType] = useState(link.link_type ?? "autre");

  if (open) {
    return (
      <li>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSave({ title: title.trim() || null, url: url.trim(), link_type: type });
            setOpen(false);
          }}
        >
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input placeholder="Titre" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
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
      <span className="kind-chip">{linkLabel(link.link_type)}</span>{" "}
      <a href={link.url ?? "#"} target="_blank" rel="noreferrer">
        {link.title || link.url}
      </a>
      {editable && (
        <>
          {" "}
          <button type="button" className="linklike" onClick={() => setOpen(true)}>
            Modifier
          </button>{" "}
          <button type="button" className="linklike danger" onClick={() => onDelete()}>
            Supprimer
          </button>
        </>
      )}
    </li>
  );
}

/** Ajout d'un lien web (datasheet, dépôt, fiche fournisseur…) à la fiche, sans changer de page. */
function LinkForm({ onAdd }: { onAdd: (title: string, url: string, linkType: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("datasheet");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Ajouter un lien
      </button>
    );
  }

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onAdd(title, url, type);
        setBusy(false);
        setTitle("");
        setUrl("");
        setOpen(false);
      }}
    >
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {LINK_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <input placeholder="Titre (facultatif)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
      <div className="row">
        <button type="submit" disabled={busy}>
          Ajouter le lien
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function ArticleEdit({
  article,
  categories,
  onSaved,
}: {
  article: ArticleDetail;
  categories: Category[];
  onSaved: () => void;
}) {
  const [name, setName] = useState(article.name);
  const [categoryId, setCategoryId] = useState(article.category_id ?? "");
  const [brand, setBrand] = useState(article.brand ?? "");
  const [mpn, setMpn] = useState(article.mpn ?? "");
  const [description, setDescription] = useState(article.description ?? "");
  const [keywords, setKeywords] = useState(article.keywords ?? "");
  const [minQuantity, setMinQuantity] = useState(article.min_quantity ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.patch(`/articles/${article.id}`, {
        version: article.version,
        name,
        category_id: categoryId || null,
        brand: brand || null,
        mpn: mpn || null,
        description: description || null,
        keywords: keywords || null,
        min_quantity: minQuantity || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Nom
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Catégorie
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryLabel(categories, c.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Marque
        <input value={brand} onChange={(e) => setBrand(e.target.value)} />
      </label>
      <label>
        Référence fabricant
        <input value={mpn} onChange={(e) => setMpn(e.target.value)} />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Mots-clés
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </label>
      <label>
        Alerte stock faible sous
        <input type="number" step="any" min="0" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit">Enregistrer</button>
    </form>
  );
}
