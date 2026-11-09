import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import type { Dashboard } from "../types";

/** Accueil « À faire » : ce qui attend une action, avec les gestes principaux en haut. */
export default function Home() {
  const { user, canWrite, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<{ id: string; name: string; query: string }[]>([]);

  useEffect(() => {
    api
      .get<Dashboard>("/dashboard")
      .then(setDash)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Erreur de chargement."));
    api
      .get<{ id: string; name: string; query: string }[]>("/saved-searches")
      .then(setViews)
      .catch(() => setViews([]));
  }, []);

  function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <>
      <div className="home-actions">
        {canWrite && (
          <Link className="home-action" to="/articles/new">
            <span aria-hidden>📷</span>
            <strong>Capturer</strong>
            <small>Photo ou nouvel objet</small>
          </Link>
        )}
        <Link className="home-action" to="/search">
          <span aria-hidden>🔍</span>
          <strong>Chercher</strong>
          <small>Retrouver un objet</small>
        </Link>
        <Link className="home-action" to="/scan">
          <span aria-hidden>▦</span>
          <strong>Scanner</strong>
          <small>Ouvrir une étiquette</small>
        </Link>
      </div>

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

      {error && <p className="error">{error}</p>}

      {dash && (
        <>
          <h2 className="home-title">À faire</h2>
          <div className="todo-grid">
            <section className="todo-card">
              <header>
                <strong>{dash.unlocated.length}</strong>
                <span>à ranger</span>
              </header>
              {dash.unlocated.length === 0 ? (
                <p className="muted small">Tout est rangé.</p>
              ) : (
                <ul>
                  {dash.unlocated.slice(0, 5).map((n) => (
                    <li key={n.id}>
                      <Link to={`/nodes/${n.slug ?? n.id}`}>{n.name ?? n.article_name ?? "Objet"}</Link>
                      <span className="muted small"> × {formatQty(n.quantity, n.unit)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link className="todo-more" to="/organisation">
                Voir l'organisation →
              </Link>
            </section>

            <section className="todo-card">
              <header>
                <strong>{dash.low_stock.length}</strong>
                <span>en stock faible</span>
              </header>
              {dash.low_stock.length === 0 ? (
                <p className="muted small">Aucun.</p>
              ) : (
                <ul>
                  {dash.low_stock.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <Link to={`/articles/${a.id}`}>{a.name}</Link>
                      <span className="muted small"> min. {formatQty(a.min_quantity)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="todo-card">
              <header>
                <strong>{dash.labels_available}</strong>
                <span>étiquettes QR libres</span>
              </header>
              <p className="muted small">{dash.labels_assigned} étiquettes déjà affectées.</p>
              <Link className="todo-more" to="/qr">
                Gérer les étiquettes →
              </Link>
            </section>
          </div>

          {views.length > 0 && (
            <>
              <h2 className="home-title">Vues enregistrées</h2>
              <div className="saved-views">
                {views.map((v) => (
                  <Link key={v.id} to={`/search?q=${encodeURIComponent(v.query)}`}>
                    ★ {v.name}
                  </Link>
                ))}
              </div>
            </>
          )}

          <p className="muted small inventory-line">
            {dash.articles} références · {dash.items} objets / lots · {dash.containers} contenants ·{" "}
            {dash.locations} emplacements
          </p>
        </>
      )}

      <p className="muted small">
        Connecté : {user.username} ({user.role}) · <Link to="/organisation">Organisation</Link> ·{" "}
        <Link to="/nodes">Lieux (ancienne vue)</Link> · <Link to="/reglages">Réglages</Link> ·{" "}
        <button type="button" className="linklike" onClick={logout}>
          Se déconnecter
        </button>
      </p>
    </>
  );
}
