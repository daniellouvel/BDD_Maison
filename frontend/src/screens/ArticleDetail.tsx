import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, fileUrl, formatQty, thumbUrl } from "../api";
import { useAuth } from "../auth";
import MovementForm from "../components/MovementForm";
import SimilarList from "../components/SimilarList";
import { categoryLabel, inheritedFields } from "../fields";
import type { ArticleDetail, Attachment, Category, FieldDef, SimilarHit } from "../types";

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

  async function upload(kind: "photo" | "datasheet", file: File | undefined) {
    if (!file || !article) return;
    const form = new FormData();
    form.append("kind", kind);
    form.append("article_id", article.id);
    form.append("title", file.name);
    form.append("file", file);
    try {
      await api.post("/attachments", form);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Envoi impossible.");
    }
  }

  if (error && !article) return <p className="error">{error}</p>;
  if (!article) return <p className="muted">Chargement…</p>;

  const photos = attachments.filter((a) => a.kind === "photo");
  const docs = attachments.filter((a) => a.kind !== "photo");

  return (
    <>
      <section className="card">
        <h1>{article.name}</h1>
        <p className="muted">
          {[
            article.category_id && categoryLabel(categories, article.category_id),
            article.brand,
            article.mpn,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {photos.length > 0 && (
          <div className="gallery">
            {photos.map((p) => (
              <a key={p.id} href={fileUrl(p.id)} target="_blank" rel="noreferrer">
                <img src={thumbUrl(p.id)} alt={p.title ?? article.name} loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {article.description && <p>{article.description}</p>}
        {fields.length > 0 && (
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
        {article.keywords && <p className="muted small">Mots-clés : {article.keywords}</p>}
        {canWrite && (
          <button type="button" className="linklike" onClick={() => setEditing(!editing)}>
            {editing ? "Fermer la modification" : "Modifier la fiche"}
          </button>
        )}
        {editing && (
          <ArticleEdit
            article={article}
            onSaved={() => {
              setEditing(false);
              load();
            }}
          />
        )}
      </section>

      <section className="card">
        <h2>Documents</h2>
        {docs.length === 0 && <p className="muted">Aucun document.</p>}
        <ul className="list">
          {docs.map((d) => {
            const url = d.kind === "link" ? (d.url ?? "#") : fileUrl(d.id);
            const isPdf = d.mime === "application/pdf";
            return (
              <li key={d.id}>
                <a href={url} target="_blank" rel="noreferrer">
                  {d.title ?? d.kind}
                </a>
                {isPdf && (
                  <>
                    <iframe className="pdf-viewer" src={url} title={d.title ?? "Document"} />
                    <a className="small" href={url} target="_blank" rel="noreferrer">
                      Ouvrir en plein écran
                    </a>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {canWrite && (
          <div className="row">
            <label className="filebutton">
              Ajouter une photo
              <input type="file" accept="image/*" capture="environment" onChange={(e) => upload("photo", e.target.files?.[0])} />
            </label>
            <label className="filebutton">
              Ajouter une datasheet (PDF)
              <input type="file" accept="application/pdf" onChange={(e) => upload("datasheet", e.target.files?.[0])} />
            </label>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

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

      {similar.length > 0 && (
        <section className="card">
          <h2>Objets ressemblants</h2>
          <SimilarList hits={similar} />
        </section>
      )}
    </>
  );
}

function ArticleEdit({ article, onSaved }: { article: ArticleDetail; onSaved: () => void }) {
  const [name, setName] = useState(article.name);
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
