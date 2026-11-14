import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import LabelField from "../components/LabelField";
import Scanner from "../components/Scanner";
import CategoryFields, { type AttrValue } from "../components/CategoryFields";
import Fold from "../components/Fold";
import CategoryPicker from "../components/CategoryPicker";
import LocationPicker from "../components/LocationPicker";
import PlanCellPicker, { hasPlan } from "../components/PlanCellPicker";
import PhotoAnalysis from "../components/PhotoAnalysis";
import { inheritedFields, nameWithValue } from "../fields";
import { fetchLabel, normalizeCode } from "../qr";
import { usePhone } from "../usePhone";
import type { Analysis, Article, Category, FieldDef, Identification, NodeDetail } from "../types";

/**
 * Étape 3 : rangement rapide. On choisit où (scan, code ou liste), puis quoi (nom ou photo reconnue),
 * on valide. Le mode série garde l'emplacement pour enchaîner plusieurs objets.
 */

type Stored = { name: string; quantity: string; unit: string };

export default function Ranger() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [dest, setDest] = useState<NodeDetail | null>(null);
  // Boîte à plan reçue par « Ranger ici » : on demande la case avant de ranger.
  const [askCell, setAskCell] = useState<NodeDetail | null>(null);

  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [catFields, setCatFields] = useState<FieldDef[]>([]);
  const [attributes, setAttributes] = useState<Record<string, AttrValue>>({});
  const [unit, setUnit] = useState("");
  const [labelCode, setLabelCode] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [existing, setExisting] = useState<Article | null>(null);
  const [suggestions, setSuggestions] = useState<Article[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [aiApplied, setAiApplied] = useState(false);

  const phone = usePhone();
  // Téléphone : trois écrans courts (1 où, 2 quoi, 3 combien). Le lieu est gardé pour la série.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showExisting, setShowExisting] = useState(false);
  const [lastDone, setLastDone] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // Dès qu'un lieu est choisi (et la case, s'il y en a un plan), on passe à l'étape « Quoi ? ».
  useEffect(() => {
    if (phone && dest && !askCell) setStep((s) => (s === 1 ? 2 : s));
  }, [phone, dest, askCell]);
  const [stored, setStored] = useState<Stored[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Objet reconnu par son étiquette : on le range tel quel, sans redemander son nom.
  const [scanned, setScanned] = useState<NodeDetail | null>(null);

  // Une étiquette déjà affectée à un objet, scannée dans le champ « Étiquette » : c'est cet objet
  // qu'on range. On ne regarde que les codes complets, pas ceux en cours de frappe.
  useEffect(() => {
    const raw = labelCode.trim();
    if (!/^QR-\d{6}$/i.test(raw)) return;
    let cancelled = false;
    fetchLabel(raw.toUpperCase())
      .then((label) => {
        if (cancelled || label.status !== "assigned" || !label.node) return;
        if (label.node.kind === "item") {
          setScanned(label.node);
          setLabelCode("");
          setError(null);
        } else {
          setError(`${label.code} est l'étiquette d'un emplacement ou d'un contenant, pas d'un objet.`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [labelCode]);

  // Arrivée depuis « Ranger ici » : l'emplacement est déjà connu.
  const to = params.get("to");
  useEffect(() => {
    inheritedFields(categories, categoryId || null).then(setCatFields).catch(() => setCatFields([]));
  }, [categories, categoryId]);

  useEffect(() => {
    api.get<Category[]>("/categories").then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!to) return;
    api
      .get<NodeDetail>(`/nodes/${to}`)
      .then((node) => {
        setDest(node);
        if (hasPlan(node)) setAskCell(node);
      })
      .catch(() => setDest(null));
  }, [to]);

  // Propositions de doublons pendant la frappe.
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
    setAiApplied(true);
  }

  function resetItem() {
    setName("");
    setQuantity("1");
    setCategoryId("");
    setAttributes({});
    setUnit("");
    setLabelCode("");
    setPhoto(null);
    setExisting(null);
    setSuggestions([]);
    setAnalysis(null);
    setAiApplied(false);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!existing && !name.trim()) return setError("Donnez un nom à l'objet.");
    setBusy(true);
    setError(null);
    try {
      let article = existing;
      if (!article) {
        article = await api.post<Article>("/articles", {
          name: nameWithValue(name.trim(), catFields, attributes),
          category_id: categoryId || null,
          attributes,
        });
      }
      const item = await api.post<{ id: string }>("/nodes", {
        kind: "item",
        parent_id: dest?.id ?? null,
        article_id: article.id,
        quantity: quantity || "1",
        unit: unit || null,
      });
      const label = labelCode.trim() ? normalizeCode(labelCode) ?? labelCode.trim() : "";
      let labelError: string | null = null;
      if (label) {
        try {
          await api.post(`/qr/labels/${label}/assign`, { node_id: item.id });
        } catch (err) {
          labelError = `Rangé, mais l'étiquette n'a pas pu être associée : ${err instanceof ApiError ? err.message : "erreur"}`;
        }
      }
      if (photo) {
        const form = new FormData();
        form.append("kind", "photo");
        form.append("article_id", article.id);
        form.append("file", photo);
        await api.post("/attachments", form).catch(() => undefined);
      }
      if (analysis) {
        api
          .post(`/ai/suggestions/${analysis.suggestion_id}/decision`, {
            status: aiApplied ? "accepted" : "rejected",
            article_id: aiApplied ? article.id : null,
          })
          .catch(() => undefined);
      }
      setStored((s) => [{ name: article!.name, quantity: quantity || "1", unit }, ...s]);
      resetItem();
      if (labelError) setError(labelError);
      // Série : on repart sur le champ du nom pour enchaîner sans toucher l'écran.
      setLastDone(`${article.name} × ${formatQty(quantity || "1", unit)}`);
      setStep(2);
      nameInput.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rangement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (phone) {
    const where = dest ? dest.breadcrumb.map((b) => b.name).join(" › ") : null;
    const hasName = Boolean(existing || name.trim());
    const qtyNumber = Number(quantity);
    const setQty = (n: number) => setQuantity(String(Math.max(0, Math.round(n * 1000) / 1000)));
    return (
      <div className="wiz">
        <div className="wiz-head">
          <span className="wiz-dots" aria-label={`Étape ${step} sur 3`}>
            {[1, 2, 3].map((n) => (
              <i key={n} className={n === step ? "on" : n < step ? "done" : ""} />
            ))}
          </span>
          {where && step > 1 && (
            <button type="button" className="wiz-where" onClick={() => setStep(1)}>
              📍 {where} <u>Changer</u>
            </button>
          )}
        </div>

        <div className="wiz-body">
          {step === 1 && (
            <section>
              <h2>Où ranger ?</h2>
              {askCell && (
                <PlanCellPicker
                  box={askCell}
                  onPick={(cell) => {
                    setDest(cell);
                    setAskCell(null);
                  }}
                  onWhole={() => setAskCell(null)}
                />
              )}
              {!askCell && <LocationPicker value={dest} onChange={setDest} emptyLabel="à choisir" />}
              {dest && !askCell && (
                <button type="button" className="wiz-next" onClick={() => setStep(2)}>
                  Continuer ›
                </button>
              )}
              {!dest && !askCell && (
                <button type="button" className="secondary" onClick={() => setStep(2)}>
                  Ranger plus tard (sans lieu)
                </button>
              )}
            </section>
          )}

          {step === 2 && (
            <section>
              {lastDone && !name && <p className="wiz-ok">✓ {lastDone} rangé</p>}
              {scanned || showExisting ? (
                <>
                  <ExistingItem dest={dest} item={scanned} onItem={setScanned} onDone={(placed) => setStored((s) => [placed, ...s])} />
                  {!scanned && (
                    <button type="button" className="secondary" onClick={() => setShowExisting(false)}>
                      ← Nouvel objet
                    </button>
                  )}
                </>
              ) : (
                <>
                  <h2>Quel objet ?</h2>
                  <input
                    ref={nameInput}
                    className="wiz-input"
                    placeholder="Nom de l'objet"
                    value={existing ? existing.name : name}
                    onChange={(e) => {
                      setExisting(null);
                      setName(e.target.value);
                    }}
                    autoFocus
                  />
                  {existing && (
                    <p className="muted small">
                      Article existant : le stock sera ajouté.{" "}
                      <button type="button" className="linklike" onClick={() => setExisting(null)}>
                        Créer un nouvel article
                      </button>
                    </p>
                  )}
                  {suggestions.length > 0 && !existing && (
                    <ul className="wiz-sugg">
                      {suggestions.map((sg) => (
                        <li key={sg.id}>
                          <button type="button" onClick={() => setExisting(sg)}>
                            Ajouter du stock à « {sg.name} »
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="wiz-tools">
                    <label className="filebutton">
                      📷 Photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => {
                          setPhoto(e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button type="button" className="secondary" onClick={() => setShowExisting(true)}>
                      🏷️ Objet déjà étiqueté
                    </button>
                  </div>
                  {photo && (
                    <PhotoAnalysis
                      photo={photo}
                      onApply={applyIdentification}
                      onUseReference={(reference) => {
                        setExisting(null);
                        if (!name.trim()) setName(reference);
                        setAiApplied(true);
                      }}
                      onPickExisting={(article) => {
                        setExisting(article);
                        setAiApplied(true);
                      }}
                      onAnalysis={(a) => {
                        setAnalysis(a);
                        setAiApplied(false);
                      }}
                    />
                  )}
                  <button type="button" className="wiz-next" disabled={!hasName} onClick={() => setStep(3)}>
                    Suivant ›
                  </button>
                </>
              )}
            </section>
          )}

          {step === 3 && (
            <form onSubmit={submit}>
              <h2>Combien ?</h2>
              <p className="wiz-what">{existing ? existing.name : name.trim()}</p>
              <div className="wiz-stepper">
                <button type="button" aria-label="Moins" onClick={() => setQty(qtyNumber - 1)}>
                  −
                </button>
                <input type="number" min="0" step="any" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                <button type="button" aria-label="Plus" onClick={() => setQty(qtyNumber + 1)}>
                  +
                </button>
              </div>
              <div className="qty-quick">
                {[1, 5, 10, 25, 50, 100].map((n) => (
                  <button key={n} type="button" className="chip" onClick={() => setQuantity(String(n))}>
                    {n}
                  </button>
                ))}
              </div>
              <Fold title="Plus de détails : unité, catégorie, étiquette" defaultOpen={Boolean(unit || categoryId || labelCode)}>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unité (pcs, g…)" />
                {!existing && (
                  <>
                    <CategoryPicker
                      categories={categories}
                      value={categoryId}
                      onChange={(id) => {
                        setCategoryId(id);
                        setAttributes({});
                      }}
                    />
                    <CategoryFields fields={catFields} values={attributes} onChange={setAttributes} />
                  </>
                )}
                <LabelField value={labelCode} onChange={setLabelCode} />
              </Fold>
              {error && <p className="error small">{error}</p>}
              <button type="submit" className="wiz-next" disabled={busy || !(qtyNumber > 0)}>
                {busy ? "Rangement…" : dest ? "✓ Ranger ici" : "✓ Enregistrer sans lieu"}
              </button>
            </form>
          )}
          {step !== 3 && error && <p className="error small">{error}</p>}
        </div>

        <div className="wiz-foot">
          {step > 1 && (
            <button type="button" className="secondary" onClick={() => setStep((step - 1) as 1 | 2)}>
              ‹ Retour
            </button>
          )}
          {stored.length > 0 && (
            <button type="button" className="secondary" onClick={() => navigate(dest ? `/e/${dest.slug ?? dest.id}` : "/")}>
              Terminer ({stored.length})
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ranger">
      <h1>Ranger</h1>

      <section className="card">
        <h2>1. Où ?</h2>
        {dest && <p className="muted small">{dest.breadcrumb.map((b) => b.name).join(" › ")}</p>}
        {askCell && (
          <PlanCellPicker
            box={askCell}
            onPick={(cell) => {
              setDest(cell);
              setAskCell(null);
            }}
            onWhole={() => setAskCell(null)}
          />
        )}
        <LocationPicker value={dest} onChange={setDest} emptyLabel="aucun (à ranger plus tard)" />
      </section>


      <ExistingItem
        dest={dest}
        item={scanned}
        onItem={setScanned}
        onDone={(placed) => setStored((s) => [placed, ...s])}
      />
      {/* Objet reconnu par son étiquette : le formulaire « nouvel objet » n'a pas lieu d'être. */}
      {!scanned && (
      <form className="card form" onSubmit={submit}>
        <h2>2. Quoi ?</h2>
        <label className="filebutton">
          📷 Photo de l'objet
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              setPhoto(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
        {photo && (
          <PhotoAnalysis
            photo={photo}
            onApply={applyIdentification}
            onUseReference={(reference) => {
              setExisting(null);
              if (!name.trim()) setName(reference);
              setAiApplied(true);
            }}
            onPickExisting={(article) => {
              setExisting(article);
              setAiApplied(true);
            }}
            onAnalysis={(a) => {
              setAnalysis(a);
              setAiApplied(false);
            }}
          />
        )}

        <input
          ref={nameInput}
          placeholder="Nom de l'objet"
          value={existing ? existing.name : name}
          onChange={(e) => {
            setExisting(null);
            setName(e.target.value);
          }}
        />
        {existing && (
          <p className="muted small">
            Article existant : le stock sera ajouté.{" "}
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
          <input type="number" min="0" step="any" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantité" />
        </div>
        <div className="qty-quick">
          {[1, 5, 10, 25, 50, 100].map((n) => (
            <button key={n} type="button" className="chip" onClick={() => setQuantity(String(n))}>
              {n}
            </button>
          ))}
        </div>
        <Fold title="Plus de détails : unité, catégorie, étiquette" defaultOpen={Boolean(unit || categoryId || labelCode)}>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unité (pcs, g…)" />
        {!existing && (
          <>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id);
                setAttributes({});
              }}
            />
            <CategoryFields fields={catFields} values={attributes} onChange={setAttributes} />
          </>
        )}
        <LabelField value={labelCode} onChange={setLabelCode} />
        </Fold>

        {error && <p className="error small">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Rangement…" : dest ? "Ranger ici" : "Enregistrer sans emplacement"}
        </button>
      </form>
      )}

      {stored.length > 0 && (
        <section className="card">
          <h2>Rangés pendant cette série ({stored.length})</h2>
          <ul className="list">
            {stored.map((s, i) => (
              <li key={i}>
                ✓ {s.name} <span className="muted small">× {formatQty(s.quantity, s.unit)}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="secondary" onClick={() => navigate(dest ? `/?n=${dest.id}` : "/")}>
            Terminer et voir l'emplacement
          </button>
        </section>
      )}
    </div>
  );
}

/**
 * Objet déjà existant : on scanne son étiquette. S'il n'a pas de place, on le range à l'emplacement
 * choisi ; s'il est déjà rangé, on le déplace vers cet emplacement (après confirmation).
 */
function ExistingItem({
  dest,
  item,
  onItem,
  onDone,
}: {
  dest: NodeDetail | null;
  item: NodeDetail | null;
  onItem: (item: NodeDetail | null) => void;
  onDone: (placed: Stored) => void;
}) {
  const [open, setOpen] = useState(false);
  const setItem = onItem;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onCode(text: string) {
    setError(null);
    setMessage(null);
    const code = normalizeCode(text);
    if (!code) return setError("Ce n'est pas une étiquette QR.");
    try {
      const label = await fetchLabel(code);
      if (label.status !== "assigned" || !label.node) {
        return setError(`${code} n'est affectée à aucun élément. Pour un nouvel objet, remplissez le formulaire ci-dessous.`);
      }
      if (label.node.kind !== "item") {
        return setError("Ce code est celui d'un emplacement ou d'un contenant : utilisez « Ranger en série » ou « Déplacer ».");
      }
      setItem(label.node);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lecture impossible.");
    }
  }

  async function place() {
    if (!item || !dest) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/nodes/${item.id}`, { version: item.version, parent_id: dest.id });
      setMessage(`« ${item.name ?? item.article_name} » ${item.parent_id ? "déplacé" : "rangé"} dans ${dest.name ?? dest.article_name}.`);
      onDone({ name: item.name ?? item.article_name ?? "Objet", quantity: item.quantity ?? "1", unit: item.unit ?? "" });
      setItem(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Rangement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const where = item ? (item.breadcrumb.length > 1 ? item.breadcrumb.slice(0, -1).map((b) => b.name).join(" › ") : "à ranger (sans emplacement)") : "";

  return (
    <section className="card">
      <h2>{item ? "Objet reconnu" : "Objet déjà existant ?"}</h2>
      {!item && (
        <>
          <button type="button" className="secondary" onClick={() => setOpen(!open)}>
            {open ? "Fermer le scan" : "Scanner l'étiquette de l'objet"}
          </button>
          {open && <Scanner onCode={onCode} hint="Scannez l'étiquette de l'objet" />}
        </>
      )}
      {item && (
        <div>
          <p>
            <strong>{item.name ?? item.article_name}</strong>
            {item.quantity && <span className="muted"> × {formatQty(item.quantity, item.unit)}</span>}
          </p>
          <p className="muted small">Actuellement : {where}</p>
          {dest ? (
            <div className="row">
              <button type="button" disabled={busy} onClick={place}>
                {item.breadcrumb.length > 1 ? "Déplacer" : "Ranger"} dans « {dest.name ?? dest.article_name} »
              </button>
              <button type="button" className="secondary" onClick={() => setItem(null)}>
                Ce n'est pas cet objet
              </button>
            </div>
          ) : (
            <p className="muted small">Choisissez d'abord l'emplacement dans « 1. Où ? ».</p>
          )}
        </div>
      )}
      {message && <p className="muted small">{message}</p>}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
