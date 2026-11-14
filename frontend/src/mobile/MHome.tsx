import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import { Sheet } from "./ui";
import RowIcon from "../components/RowIcon";
import LocationPicker from "../components/LocationPicker";
import type { Category, Dashboard, Loan, MovementEntry, NodeDetail, Purchase, SearchHit } from "../types";

/** Accueil mobile : la recherche d'abord, puis ce qu'il y a à faire. Rien ne défile sans recherche. */
export default function MHome({ statusLabel }: { statusLabel: string | null }) {
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loans, setLoans] = useState<number | null>(null);
  const [toBuy, setToBuy] = useState<number | null>(null);
  // Filtres de la recherche : on peut chercher sans rien taper (ex. tout ce qui est prêté).
  const [lowOnly, setLowOnly] = useState(false);
  const [lentOnly, setLentOnly] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [place, setPlace] = useState<NodeDetail | null>(null);
  const [placeSheet, setPlaceSheet] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const filtered = lowOnly || lentOnly || Boolean(categoryId) || Boolean(place);
  const [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  const [places] = useState<{ id: string; name: string }[]>(() => {
    try {
      const list = JSON.parse(localStorage.getItem("mw_recent_places") ?? "[]");
      return Array.isArray(list) ? list.slice(0, 6) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    api.get<Category[]>("/categories").then(setCategories).catch(() => setCategories([]));
    api.get<Dashboard>("/dashboard").then(setDash).catch(() => setDash(null));
    api.get<Loan[]>("/loans?open=true").then((l) => setLoans(l.length)).catch(() => setLoans(null));
    api
      .get<MovementEntry[]>("/stock/history?limit=40")
      .then((rows) => {
        const seen = new Set<string>();
        const list: { id: string; name: string }[] = [];
        for (const r of rows) {
          if (seen.has(r.article_id)) continue;
          seen.add(r.article_id);
          list.push({ id: r.article_id, name: r.article_name });
        }
        setRecent(list.slice(0, 8));
      })
      .catch(() => setRecent([]));
    api.get<Purchase[]>("/purchases?status=to_buy").then((p) => setToBuy(p.length)).catch(() => setToBuy(null));
  }, []);

  // Recherche au fil de la frappe : pas de bouton à viser, les résultats remplacent les raccourcis.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 && !filtered) {
      setHits(null);
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const qs = new URLSearchParams();
      if (term.length >= 2) qs.set("q", term);
      if (lowOnly) qs.set("low_stock", "true");
      if (lentOnly) qs.set("lent", "true");
      if (categoryId) qs.set("category_id", categoryId);
      if (place) qs.set("place_id", place.id);
      api
        .get<SearchHit[]>(`/search?${qs.toString()}`)
        .then((list) => {
          setHits(list);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Recherche impossible."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, lowOnly, lentOnly, categoryId, place, filtered]);

  // Anciennes adresses « /?n=… » (QR, liens) : on ouvre l'élément.
  const legacy = params.get("n");
  if (legacy) return <Navigate to={`/e/${encodeURIComponent(legacy)}`} replace />;

  return (
    <div className="m-view">
      <div className="m-home-top">
        <h1>
          MyWorkshop {statusLabel && <small>● {statusLabel}</small>}
        </h1>
        <div className="m-search">
          <input
            type="search"
            placeholder="Chercher un objet…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Chercher un objet"
          />
        </div>
        <div className="m-filters">
          <button type="button" className={`chip${lowOnly ? " on" : ""}`} onClick={() => setLowOnly(!lowOnly)}>
            Stock bas
          </button>
          <button type="button" className={`chip${lentOnly ? " on" : ""}`} onClick={() => setLentOnly(!lentOnly)}>
            Prêté
          </button>
          <select className={`chip${categoryId ? " on" : ""}`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Catégorie">
            <option value="">Catégorie</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className={`chip${place ? " on" : ""}`} onClick={() => (place ? setPlace(null) : setPlaceSheet(true))}>
            {place ? `${place.name ?? "Lieu"} ✕` : "Lieu"}
          </button>
        </div>
      </div>

      {placeSheet && (
        <Sheet title="Chercher dans quel lieu ?" onClose={() => setPlaceSheet(false)}>
          <LocationPicker
            value={place}
            onChange={(n) => {
              setPlace(n);
              if (n) setPlaceSheet(false);
            }}
            emptyLabel="tous les lieux"
          />
        </Sheet>
      )}

      <div className="m-body">
        {error && <p className="error m-pad">{error}</p>}

        {hits && (
          <ul className="m-list">
            {hits.length === 0 && <li className="m-empty">Aucun résultat{q.trim() ? ` pour « ${q.trim()} »` : ""}.</li>}
            {hits.map((h) => {
              const first = h.locations[0];
              const where =
                h.locations.length === 0
                  ? "Aucun lot en stock"
                  : `${first.path.length ? first.path.join(" › ") : "Non rangé"}${h.locations.length > 1 ? ` · +${h.locations.length - 1} autre(s)` : ""}`;
              return (
                <li key={h.article.id}>
                  <button type="button" className="m-row" onClick={() => navigate(`/a/${h.article.id}`)}>
                    <RowIcon photoId={h.photo_id} fallback="🔩" />
                    <span className="txt">
                      <b>{h.article.name}</b>
                      <small>{where}</small>
                    </span>
                    <span className="end">
                      <b>{formatQty(h.total_quantity)}</b> ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!hits && (
          <>
            <div className="m-tiles">
              <Link to="/lieux" className={`m-tile${dash && dash.unlocated.length > 0 ? " alert" : ""}`}>
                <b>{dash ? dash.unlocated.length : "…"}</b>
                <span>À ranger</span>
              </Link>
              <Link to="/stock-bas" className={`m-tile${dash && dash.low_stock.length > 0 ? " alert" : ""}`}>
                <b>{dash ? dash.low_stock.length : "…"}</b>
                <span>Stock bas</span>
              </Link>
              <Link to="/achats" className="m-tile">
                <b>{toBuy ?? "…"}</b>
                <span>À acheter</span>
              </Link>
              <Link to="/prets" className="m-tile">
                <b>{loans ?? "…"}</b>
                <span>Prêts en cours</span>
              </Link>
            </div>
            {recent.length > 0 && (
              <>
                <p className="m-group">Récemment utilisés</p>
                <div className="m-chips">
                  {recent.map((r) => (
                    <Link key={r.id} to={`/a/${r.id}`} className="chip">
                      {r.name}
                    </Link>
                  ))}
                </div>
              </>
            )}
            {places.length > 0 && (
              <>
                <p className="m-group">Mes lieux</p>
                <div className="m-chips">
                  {places.map((r) => (
                    <Link key={r.id} to={`/e/${r.id}`} className="chip">
                      {r.name}
                    </Link>
                  ))}
                </div>
              </>
            )}
            {canWrite && (
              <Link to="/ranger" className="m-big">
                ＋ Ranger un objet
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Articles sous leur seuil d'alerte. */
export function MLowStock() {
  const navigate = useNavigate();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Dashboard>("/dashboard")
      .then(setDash)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible."));
  }, []);

  return (
    <>
      {error && <p className="error">{error}</p>}
      {dash && dash.low_stock.length === 0 && <p className="m-empty">Aucun article sous son seuil d'alerte.</p>}
      <ul className="m-list">
        {dash?.low_stock.map((a) => (
          <li key={a.id}>
            <button type="button" className="m-row" onClick={() => navigate(`/a/${a.id}`)}>
              <span className="ic">⚠️</span>
              <span className="txt">
                <b>{a.name}</b>
                <small>Seuil : {formatQty(a.min_quantity)}</small>
              </span>
              <span className="end">›</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
