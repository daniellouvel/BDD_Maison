import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import Scanner from "../components/Scanner";
import { EVENT_LABEL, extractCode, fetchLabel, STATUS_LABEL } from "../qr";
import LocationPicker from "../components/LocationPicker";
import type { Label, NodeDetail, SearchHit } from "../types";

/** Fiche d'une étiquette. Sert aussi de cible aux QR encodant une URL (/l/QR-000123). */
export default function LabelDetail({ redirectAssigned = false }: { redirectAssigned?: boolean }) {
  const { code: rawCode } = useParams();
  const code = extractCode(rawCode ?? "");
  const { user, canWrite } = useAuth();
  const navigate = useNavigate();
  const [label, setLabel] = useState<Label | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const load = useCallback(async () => {
    if (!code) return setError("Code d'étiquette invalide.");
    try {
      const found = await fetchLabel(code);
      if (redirectAssigned && found.status === "assigned" && found.node) {
        navigate(`/nodes/${found.node.id}`, { replace: true });
        return;
      }
      setLabel(found);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
  }, [code, navigate, redirectAssigned]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, body?: unknown) {
    setError(null);
    try {
      setLabel(await api.post<Label>(`/qr/labels/${code}/${path}`, body));
      setReplacing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action impossible.");
    }
  }

  async function disable() {
    const reason = window.prompt("Motif (perdue, détruite, illisible…)", "Perdue");
    if (reason?.trim()) await act("disable", { reason: reason.trim() });
  }

  if (error && !label) return <p className="error">{error}</p>;
  if (!label) return <p className="muted">Chargement…</p>;

  return (
    <>
      <section className="card">
        <h1>{label.code}</h1>
        <p>
          <span className={`badge badge-${label.status}`}>{STATUS_LABEL[label.status]}</span>
          {label.disabled_reason && <span className="muted"> · {label.disabled_reason}</span>}
        </p>
        {label.node && (
          <p>
            Sur :{" "}
            <Link to={`/nodes/${label.node.id}`}>{label.node.breadcrumb.map((b) => b.name).join(" › ")}</Link>
            {label.node.archived && <span className="muted"> (archivé)</span>}
          </p>
        )}
        <p className="muted small">
          Imprimée {label.print_count} fois · contenu du QR : <code>{label.payload}</code>
        </p>
        {canWrite && (
          <div className="row">
            {label.status === "assigned" && (
              <button type="button" className="secondary" onClick={() => setReplacing(!replacing)}>
                Remplacer (étiquette abîmée)
              </button>
            )}
            {label.status !== "disabled" && (
              <button type="button" className="secondary" onClick={disable}>
                Désactiver (perdue, détruite)
              </button>
            )}
            {label.status === "disabled" && user.role === "admin" && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  window.confirm("Remettre cette étiquette en service comme étiquette vierge ?") && act("reactivate")
                }
              >
                Réactiver
              </button>
            )}
          </div>
        )}
        {replacing && (
          <Scanner
            hint="Scannez l'étiquette vierge qui remplace celle-ci"
            onCode={(newCode) => act("replace", { new_code: newCode })}
          />
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {canWrite && label.status === "available" && (
        <AssignExisting
          code={label.code}
          onDone={(nodeId) => navigate(`/nodes/${nodeId}`)}
        />
      )}

      <section className="card">
        <h2>Historique</h2>
        <ul className="list">
          {[...label.events].reverse().map((e, i) => (
            <li key={i}>
              <strong>{EVENT_LABEL[e.event] ?? e.event}</strong>{" "}
              <span className="muted small">{new Date(e.at).toLocaleString("fr-FR")}</span>
              {e.detail && <div className="small">{e.detail}</div>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Affecte une étiquette vierge à un lot (par recherche d'objet) ou à un lieu ou une boîte existants. */
function AssignExisting({ code, onDone }: { code: string; onDone: (nodeId: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [place, setPlace] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits([]);
    const timer = window.setTimeout(() => {
      api.get<SearchHit[]>(`/search?q=${encodeURIComponent(term)}&limit=8`).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  async function assign(nodeId: string) {
    setError(null);
    try {
      await api.post(`/qr/labels/${code}/assign`, { node_id: nodeId });
      onDone(nodeId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Affectation impossible.");
    }
  }

  return (
    <section className="card">
      <h2>Affecter à un élément existant</h2>
      <p className="muted small">Cherchez l'objet (son lot), ou choisissez un lieu ou une boîte.</p>
      <input type="search" placeholder="Nom de l'objet…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="list">
        {hits.flatMap((h) =>
          h.locations.map((l) => (
            <li key={l.node_id}>
              <button type="button" className="linklike" onClick={() => assign(l.node_id)}>
                {h.article.name} — {l.path.length ? l.path.join(" › ") : "non rangé"} (× {l.quantity})
              </button>
            </li>
          )),
        )}
      </ul>
      <h3>Ou un lieu / une boîte</h3>
      <LocationPicker value={place} onChange={setPlace} emptyLabel="à choisir" />
      {place && (
        <button type="button" onClick={() => assign(place.id)}>
          Affecter à « {place.name} »
        </button>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
