import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import type { Dashboard, Loan, Purchase, SearchHit } from "../types";

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

  useEffect(() => {
    api.get<Dashboard>("/dashboard").then(setDash).catch(() => setDash(null));
    api.get<Loan[]>("/loans?open=true").then((l) => setLoans(l.length)).catch(() => setLoans(null));
    api.get<Purchase[]>("/purchases?status=to_buy").then((p) => setToBuy(p.length)).catch(() => setToBuy(null));
  }, []);

  // Recherche au fil de la frappe : pas de bouton à viser, les résultats remplacent les raccourcis.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<SearchHit[]>(`/search?q=${encodeURIComponent(term)}`)
        .then((list) => {
          setHits(list);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Recherche impossible."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

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
      </div>

      <div className="m-body">
        {error && <p className="error m-pad">{error}</p>}

        {hits && (
          <ul className="m-list">
            {hits.length === 0 && <li className="m-empty">Aucun résultat pour « {q.trim()} ».</li>}
            {hits.map((h) => {
              const first = h.locations[0];
              const where =
                h.locations.length === 0
                  ? "Aucun lot en stock"
                  : `${first.path.length ? first.path.join(" › ") : "Non rangé"}${h.locations.length > 1 ? ` · +${h.locations.length - 1} autre(s)` : ""}`;
              return (
                <li key={h.article.id}>
                  <button type="button" className="m-row" onClick={() => navigate(`/a/${h.article.id}`)}>
                    <span className="ic">🔩</span>
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
