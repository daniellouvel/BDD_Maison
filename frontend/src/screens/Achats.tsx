import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import LocationPicker from "../components/LocationPicker";
import type { Article, NodeDetail, Offer, PricePoint, Purchase, PurchaseStatus, Supplier } from "../types";

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  to_buy: "À acheter",
  ordered: "Commandé",
  received: "Reçu",
  cancelled: "Annulé",
};

type Filter = "active" | "all" | PurchaseStatus;

const FILTER_LABEL: Record<Filter, string> = {
  active: "À acheter et commandés",
  all: "Tous",
  to_buy: "À acheter",
  ordered: "Commandés",
  received: "Reçus",
  cancelled: "Annulés",
};

/** Prix en euros, ou tiret si inconnu. Les prix sont des chaînes décimales venant de l'API. */
function euro(value: string | null): string {
  if (value === null) return "—";
  return `${Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
}

function dateShort(value: string): string {
  return new Date(value).toLocaleDateString("fr-FR");
}

/** Achats : liste de courses, et prix par fournisseur pour un article. Rien ici ne touche au stock,
 * sauf la réception, qui range l'article dans l'emplacement choisi. */
export default function Achats() {
  const { canWrite } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [error, setError] = useState<string | null>(null);

  // Ajout à la liste
  const [article, setArticle] = useState<Article | null>(null);
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [offerId, setOfferId] = useState("");
  const [busy, setBusy] = useState(false);

  // Réception
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [location, setLocation] = useState<NodeDetail | null>(null);

  // Offres et prix de l'article choisi
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerFor, setOfferFor] = useState<Offer | null>(null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [newSupplier, setNewSupplier] = useState("");
  const [newRef, setNewRef] = useState("");
  const [newPrice, setNewPrice] = useState("");

  function loadPurchases() {
    api
      .get<Purchase[]>("/purchases")
      .then(setPurchases)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Liste indisponible."));
  }

  function loadOffers(articleId: string) {
    api.get<Offer[]>(`/articles/${articleId}/offers`).then(setOffers).catch(() => setOffers([]));
  }

  function loadPrices(offer: Offer) {
    api.get<PricePoint[]>(`/offers/${offer.id}/prices`).then(setPrices).catch(() => setPrices([]));
  }

  useEffect(() => {
    loadPurchases();
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  useEffect(() => {
    setOffers([]);
    setOfferFor(null);
    setPrices([]);
    setOfferId("");
    if (article) loadOffers(article.id);
  }, [article?.id]);

  const visible = (purchases ?? []).filter((p) => {
    if (filter === "all") return true;
    if (filter === "active") return p.status === "to_buy" || p.status === "ordered";
    return p.status === filter;
  });

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/purchases", {
        article_id: article?.id ?? null,
        label: label.trim(),
        offer_id: offerId || null,
        quantity: quantity || "1",
        unit_price: unitPrice.trim() || null,
      });
      setArticle(null);
      setLabel("");
      setQuantity("1");
      setUnitPrice("");
      setOfferId("");
      loadPurchases();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(p: Purchase, status: PurchaseStatus) {
    setError(null);
    try {
      await api.patch(`/purchases/${p.id}`, { version: p.version, status });
      loadPurchases();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mise à jour impossible.");
      loadPurchases();
    }
  }

  async function receive() {
    if (!receiving || !location) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/purchases/${receiving.id}/receive`, { version: receiving.version, node_id: location.id });
      setReceiving(null);
      setLocation(null);
      loadPurchases();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Réception impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function addOffer(e: FormEvent) {
    e.preventDefault();
    if (!article || !newSupplier) return;
    setError(null);
    try {
      await api.post(`/articles/${article.id}/offers`, {
        supplier_id: newSupplier,
        supplier_ref: newRef.trim() || null,
      });
      setNewSupplier("");
      setNewRef("");
      loadOffers(article.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ajout de l'offre impossible.");
    }
  }

  async function addPrice(e: FormEvent) {
    e.preventDefault();
    if (!offerFor) return;
    setError(null);
    try {
      await api.post(`/offers/${offerFor.id}/prices`, { unit_price: newPrice.replace(",", ".") });
      setNewPrice("");
      loadPrices(offerFor);
      if (article) loadOffers(article.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Prix refusé.");
    }
  }

  return (
    <div>
      <h1>Achats</h1>
      <p className="muted small">
        La liste de courses ne change pas le stock. Recevoir un achat range l'article dans l'emplacement choisi.
      </p>
      {error && <p className="error small">{error}</p>}

      {canWrite && (
        <form className="card form" onSubmit={add}>
          <h2>Ajouter à la liste</h2>
          <ArticlePicker value={article} onChange={setArticle} />
          <input
            placeholder={article ? "Libellé (facultatif, sinon le nom de l'article)" : "Libellé (ex. Colle époxy)"}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="row">
            <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantité" />
            <input
              type="number"
              min="0"
              step="0.0001"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="Prix unitaire (€, facultatif)"
            />
          </div>
          {article && offers.length > 0 && (
            <select value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">— fournisseur (facultatif) —</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.supplier_name}
                  {o.last_unit_price ? ` · ${euro(o.last_unit_price)}` : ""}
                </option>
              ))}
            </select>
          )}
          <button type="submit" disabled={busy || (!article && !label.trim())}>
            Ajouter à la liste
          </button>
        </form>
      )}

      <section className="card">
        <div className="row">
          <h2>Liste de courses{purchases ? ` (${visible.length})` : ""}</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <option key={f} value={f}>
                {FILTER_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        {purchases === null && <p className="muted small">Chargement…</p>}
        {purchases && visible.length === 0 && <p className="muted small">Rien à afficher.</p>}
        <ul className="list">
          {visible.map((p) => (
            <li key={p.id}>
              <strong>{p.label}</strong>
              <span className="muted small">
                {" "}
                × {Number(p.quantity)}
                {p.supplier_name ? ` · ${p.supplier_name}` : ""}
                {p.unit_price ? ` · ${euro(p.unit_price)} l'unité` : ""} · {STATUS_LABEL[p.status]}
              </span>
              {canWrite && (p.status === "to_buy" || p.status === "ordered") && (
                <div className="row">
                  {p.status === "to_buy" && (
                    <button type="button" className="secondary" onClick={() => setStatus(p, "ordered")}>
                      Commander
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    disabled={!p.article_id}
                    title={p.article_id ? undefined : "Liez un article pour le ranger à la réception"}
                    onClick={() => {
                      setReceiving(p);
                      setLocation(null);
                    }}
                  >
                    Reçu, ranger
                  </button>
                  <button type="button" className="linklike" onClick={() => setStatus(p, "cancelled")}>
                    Annuler
                  </button>
                </div>
              )}
              {receiving?.id === p.id && (
                <div className="card">
                  <p className="small">Où ranger « {p.label} » ?</p>
                  <LocationPicker value={location} onChange={setLocation} emptyLabel="— choisir un emplacement —" />
                  <div className="row">
                    <button type="button" disabled={!location || busy} onClick={receive}>
                      Ranger ici
                    </button>
                    <button type="button" className="secondary" onClick={() => setReceiving(null)}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Prix par fournisseur</h2>
        <ArticlePicker value={article} onChange={setArticle} />
        {article && (
          <>
            {offers.length === 0 && <p className="muted small">Aucune offre pour cet article.</p>}
            <ul className="list">
              {offers.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => {
                      setOfferFor(o);
                      loadPrices(o);
                    }}
                  >
                    {o.supplier_name}
                  </button>
                  <span className="muted small">
                    {o.supplier_ref ? ` · réf. ${o.supplier_ref}` : ""}
                    {o.last_unit_price ? ` · ${euro(o.last_unit_price)} (${dateShort(o.last_observed_at ?? "")})` : " · pas de prix"}
                  </span>
                </li>
              ))}
            </ul>

            {canWrite && (
              <form className="form" onSubmit={addOffer}>
                <div className="row">
                  <select value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)}>
                    <option value="">— fournisseur —</option>
                    {suppliers
                      .filter((s) => !offers.some((o) => o.supplier_id === s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <input placeholder="Référence chez le fournisseur" value={newRef} onChange={(e) => setNewRef(e.target.value)} />
                  <button type="submit" disabled={!newSupplier}>
                    Ajouter l'offre
                  </button>
                </div>
              </form>
            )}

            {offerFor && (
              <div className="card">
                <h3>{offerFor.supplier_name} : historique des prix</h3>
                {prices.length === 0 && <p className="muted small">Aucun prix enregistré.</p>}
                <ul className="list">
                  {prices.map((pt) => (
                    <li key={pt.id}>
                      {euro(pt.unit_price)} · {dateShort(pt.observed_at)}{" "}
                      <span className="muted small">{pt.source === "order" ? "(commande)" : "(saisi)"}</span>
                    </li>
                  ))}
                </ul>
                {canWrite && (
                  <form className="row" onSubmit={addPrice}>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="Prix unitaire (€)"
                    />
                    <button type="submit" disabled={!newPrice}>
                      Enregistrer le prix
                    </button>
                  </form>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Choix d'un article du catalogue par recherche. */
function ArticlePicker({ value, onChange }: { value: Article | null; onChange: (article: Article | null) => void }) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Article[]>([]);

  useEffect(() => {
    if (term.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<Article[]>(`/articles?q=${encodeURIComponent(term.trim())}&limit=6`)
        .then(setHits)
        .catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  if (value) {
    return (
      <p className="small">
        Article : <strong>{value.name}</strong>{" "}
        <button type="button" className="linklike" onClick={() => onChange(null)}>
          Changer
        </button>
      </p>
    );
  }
  return (
    <div>
      <input placeholder="Chercher un article du catalogue (facultatif)" value={term} onChange={(e) => setTerm(e.target.value)} />
      {hits.length > 0 && (
        <ul className="suggestions">
          {hits.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  onChange(a);
                  setTerm("");
                  setHits([]);
                }}
              >
                {a.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
