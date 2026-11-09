import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import LabelPicker from "../components/LabelPicker";
import PhotoAnalysis from "../components/PhotoAnalysis";
import { categoryLabel, inheritedFields } from "../fields";
import type { Analysis, Article, Category, FieldDef, Identification, NodeDetail } from "../types";

type AttrValue = string | number | boolean;

export default function ArticleNew() {
  const [params] = useSearchParams();
  const parentId = params.get("parent");
  const navigate = useNavigate();

  const [parent, setParent] = useState<NodeDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);

  const [name, setName] = useState("");
  const [existing, setExisting] = useState<Article | null>(null);
  const [suggestions, setSuggestions] = useState<Article[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [detailed, setDetailed] = useState(false);
  const [brand, setBrand] = useState("");
  const [mpn, setMpn] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [attributes, setAttributes] = useState<Record<string, AttrValue>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [labelCode, setLabelCode] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [aiApplied, setAiApplied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Article | null>(null);

  useEffect(() => {
    api.get<Category[]>("/categories").then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!parentId) return setParent(null);
    api.get<NodeDetail>(`/nodes/${parentId}`).then(setParent).catch(() => setParent(null));
  }, [parentId]);

  useEffect(() => {
    setAttributes({});
    if (!categoryId) return setFields([]);
    inheritedFields(categories, categoryId).then(setFields).catch(() => setFields([]));
  }, [categoryId, categories]);

  // Suggestions d'articles existants pour éviter les doublons.
  useEffect(() => {
    if (existing || name.trim().length < 2) return setSuggestions([]);
    const timer = window.setTimeout(() => {
      api
        .get<Article[]>(`/articles?q=${encodeURIComponent(name.trim())}&limit=5`)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [name, existing]);

  function applyIdentification(ident: Identification) {
    setExisting(null);
    if (ident.name) setName(ident.name);
    if (ident.category_id) setCategoryId(ident.category_id);
    if (ident.brand) setBrand(ident.brand);
    if (ident.mpn) setMpn(ident.mpn);
    if (ident.description) setDescription(ident.description);
    if (ident.keywords.length) setKeywords(ident.keywords.join(" "));
    setDetailed(true);
    setAiApplied(true);
  }

  function applyReference(reference: string) {
    setExisting(null);
    setMpn(reference);
    if (!name.trim()) setName(reference);
    setDetailed(true);
    setAiApplied(true);
  }

  function pickExisting(article: Article) {
    setExisting(article);
    setAiApplied(true);
  }

  function reset() {
    setName("");
    setExisting(null);
    setQuantity("1");
    setPhoto(null);
    setAnalysis(null);
    setAiApplied(false);
    setLabelCode(null);
    setSaved(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let article = existing;
      if (!article) {
        article = await api.post<Article>("/articles", {
          name: name.trim(),
          category_id: categoryId || null,
          brand: brand || null,
          mpn: mpn || null,
          description: description || null,
          keywords: keywords || null,
          min_quantity: minQuantity || null,
          attributes,
        });
      }
      let itemId: string | null = null;
      if (quantity !== "" && Number(quantity) >= 0) {
        const item = await api.post<{ id: string }>("/nodes", {
          kind: "item",
          parent_id: parentId,
          article_id: article.id,
          quantity,
          unit: unit || null,
        });
        itemId = item.id;
      }
      setWarning(null);
      if (labelCode && itemId) {
        // L'objet est déjà enregistré : un échec ici ne doit pas inciter à tout ressaisir.
        try {
          await api.post(`/qr/labels/${labelCode}/assign`, { node_id: itemId });
        } catch (err) {
          setWarning(
            `Objet enregistré, mais l'étiquette ${labelCode} n'a pas été associée : ${
              err instanceof ApiError ? err.message : "erreur"
            }`,
          );
        }
      }
      if (photo) {
        const form = new FormData();
        form.append("kind", "photo");
        form.append("article_id", article.id);
        form.append("file", photo);
        await api.post("/attachments", form);
      }
      if (analysis) {
        // Trace de ce qui a été fait des suggestions ; sans importance pour l'utilisateur.
        api
          .post(`/ai/suggestions/${analysis.suggestion_id}/decision`, {
            status: aiApplied ? "accepted" : "rejected",
            article_id: aiApplied ? article.id : null,
          })
          .catch(() => undefined);
      }
      setSaved(article);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <section className="card">
        <h2>Enregistré : {saved.name}</h2>
        {parent && <p className="muted">Dans {parent.breadcrumb.map((b) => b.name).join(" › ")}</p>}
        {labelCode && !warning && <p>Étiquette {labelCode} associée.</p>}
        {warning && <p className="error">{warning}</p>}
        <div className="quick">
          <button type="button" onClick={reset}>
            Ajouter un autre ici
          </button>
          <Link to={`/articles/${saved.id}`}>Voir la fiche</Link>
          {parentId && <Link to={`/nodes/${parentId}`}>Retour à l'emplacement</Link>}
        </div>
      </section>
    );
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Ajouter un objet</h2>
      <p className="muted">
        Emplacement :{" "}
        {parent ? parent.breadcrumb.map((b) => b.name).join(" › ") : "non localisé (à ranger plus tard)"}
      </p>

      <label>
        Photo
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {photo && (
        <PhotoAnalysis
          photo={photo}
          onApply={applyIdentification}
          onUseReference={applyReference}
          onPickExisting={pickExisting}
          onAnalysis={(a) => {
            setAnalysis(a);
            setAiApplied(false);
          }}
        />
      )}

      <label>
        Nom *
        <input
          value={existing ? existing.name : name}
          onChange={(e) => {
            setExisting(null);
            setName(e.target.value);
          }}
          required
          autoFocus
        />
      </label>
      {existing && (
        <p className="muted small">
          Article existant sélectionné.{" "}
          <button type="button" className="linklike" onClick={() => setExisting(null)}>
            Créer un nouvel article
          </button>
        </p>
      )}
      {suggestions.length > 0 && !existing && (
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button type="button" className="linklike" onClick={() => setExisting(s)}>
                Ajouter du stock à « {s.name} »
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <label>
          Quantité
          <input type="number" inputMode="decimal" step="any" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label>
          Unité
          <input placeholder="pcs, g, m…" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
      </div>

      {!existing && (
        <>
          <label>
            Catégorie
            <div className="row">
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryLabel(categories, c.id)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  const label = window.prompt("Nom de la nouvelle catégorie (ex. Résistance, Visserie)");
                  if (!label?.trim()) return;
                  try {
                    const created = await api.post<Category>("/categories", { name: label.trim(), parent_id: null });
                    setCategories(await api.get<Category[]>("/categories"));
                    setCategoryId(created.id);
                  } catch (e) {
                    setError(e instanceof ApiError ? e.message : "Création de la catégorie impossible.");
                  }
                }}
              >
                + catégorie
              </button>
            </div>
          </label>

          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.unit ? ` (${f.unit})` : ""}
              {f.required ? " *" : ""}
              {f.type === "enum" ? (
                <select
                  value={String(attributes[f.key] ?? "")}
                  onChange={(e) => setAttributes({ ...attributes, [f.key]: e.target.value })}
                  required={f.required}
                >
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === "bool" ? (
                <input
                  type="checkbox"
                  checked={Boolean(attributes[f.key])}
                  onChange={(e) => setAttributes({ ...attributes, [f.key]: e.target.checked })}
                />
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  step="any"
                  required={f.required}
                  value={String(attributes[f.key] ?? "")}
                  onChange={(e) =>
                    setAttributes({
                      ...attributes,
                      [f.key]: f.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}

          <button type="button" className="linklike" onClick={() => setDetailed(!detailed)}>
            {detailed ? "Masquer la fiche détaillée" : "Fiche détaillée…"}
          </button>
          {detailed && (
            <>
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
            </>
          )}
        </>
      )}

      {quantity !== "" && <LabelPicker value={labelCode} onChange={setLabelCode} />}

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" className="secondary" onClick={() => navigate(-1)}>
          Annuler
        </button>
      </div>
    </form>
  );
}
