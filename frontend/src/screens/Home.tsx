import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import type { Dashboard } from "../types";

export default function Home() {
  const { user, canWrite, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Dashboard>("/dashboard")
      .then(setDash)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Erreur de chargement."));
  }, []);

  function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <>
      <form className="searchbar" onSubmit={search}>
        <input
          type="search"
          placeholder="Rechercher (ex. ESP32)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          enterKeyHint="search"
        />
        <button type="submit">OK</button>
      </form>

      <div className="quick">
        <Link to="/scan">Scanner</Link>
        {canWrite && <Link to="/articles/new">Ajouter</Link>}
        <Link to="/search">Rechercher</Link>
        <Link to="/nodes">Emplacements</Link>
      </div>

      {error && <p className="error">{error}</p>}
      {dash && (
        <>
          <section className="stats">
            <div><strong>{dash.articles}</strong>références</div>
            <div><strong>{dash.items}</strong>objets / lots</div>
            <div><strong>{dash.containers}</strong>contenants</div>
            <div><strong>{dash.locations}</strong>emplacements</div>
            <Link to="/qr" className="stat-link"><strong>{dash.labels_available}</strong>étiquettes QR libres</Link>
            <Link to="/qr" className="stat-link"><strong>{dash.labels_assigned}</strong>étiquettes affectées</Link>
          </section>

          <section className="card">
            <h2>Stocks faibles ({dash.low_stock.length})</h2>
            {dash.low_stock.length === 0 ? (
              <p className="muted">Aucun.</p>
            ) : (
              <ul className="list">
                {dash.low_stock.map((a) => (
                  <li key={a.id}>
                    <Link to={`/articles/${a.id}`}>{a.name}</Link>
                    <span className="muted"> min. {formatQty(a.min_quantity)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Non localisés ({dash.unlocated.length})</h2>
            {dash.unlocated.length === 0 ? (
              <p className="muted">Tout est rangé.</p>
            ) : (
              <ul className="list">
                {dash.unlocated.map((n) => (
                  <li key={n.id}>
                    <Link to={`/nodes/${n.id}`}>{n.name ?? n.article_name ?? "Objet"}</Link>
                    <span className="muted"> × {formatQty(n.quantity, n.unit)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <p className="muted small">
        Connecté : {user.username} ({user.role}) ·{" "}
        <button type="button" className="linklike" onClick={logout}>
          Se déconnecter
        </button>
      </p>
    </>
  );
}
