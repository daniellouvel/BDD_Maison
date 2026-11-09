import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import Scanner from "../components/Scanner";
import { fetchLabel } from "../qr";
import type { Label, NodeDetail } from "../types";

type Mode = "open" | "move";

const path = (n: NodeDetail) => n.breadcrumb.map((b) => b.name).join(" › ");

export default function Scan() {
  const [params, setParams] = useSearchParams();
  const { canWrite } = useAuth();
  const mode: Mode = params.get("mode") === "move" ? "move" : "open";
  const preselected = params.get("source");

  return (
    <>
      <div className="tabs">
        <button type="button" className={mode === "open" ? "" : "secondary"} onClick={() => setParams({})}>
          Ouvrir
        </button>
        {canWrite && (
          <button
            type="button"
            className={mode === "move" ? "" : "secondary"}
            onClick={() => setParams({ mode: "move" })}
          >
            Déplacer
          </button>
        )}
      </div>
      {mode === "open" ? <OpenMode /> : <MoveMode key={preselected ?? "scan"} preselected={preselected} />}
    </>
  );
}

function OpenMode() {
  const navigate = useNavigate();
  const [label, setLabel] = useState<Label | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCode(code: string) {
    setError(null);
    setLabel(null);
    try {
      const found = await fetchLabel(code);
      if (found.status === "assigned" && found.node) {
        navigate(`/nodes/${found.node.id}`);
        return;
      }
      setLabel(found);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lecture impossible.");
    }
  }

  return (
    <>
      <Scanner onCode={onCode} hint="Scannez l'étiquette d'un objet, d'une boîte ou d'un emplacement" />
      {error && <p className="error">{error}</p>}
      {label?.status === "available" && (
        <section className="card">
          <h2>{label.code} : étiquette vierge</h2>
          <p className="muted">
            Pour l'utiliser, ouvrez l'emplacement concerné puis « Ajouter un objet ici » ou « Créer ici », et
            scannez-la à la fin. Pour un élément existant, ouvrez-le et choisissez « Associer une étiquette ».
          </p>
          <Link to={`/qr/labels/${label.code}`}>Détail de l'étiquette</Link>
        </section>
      )}
      {label?.status === "disabled" && (
        <section className="card">
          <h2>{label.code} : étiquette désactivée</h2>
          <p className="muted">{label.disabled_reason}</p>
          <Link to={`/qr/labels/${label.code}`}>Voir l'historique</Link>
        </section>
      )}
    </>
  );
}

function MoveMode({ preselected }: { preselected: string | null }) {
  const [source, setSource] = useState<NodeDetail | null>(null);
  const [destination, setDestination] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<NodeDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preselected) return;
    api.get<NodeDetail>(`/nodes/${preselected}`).then(setSource).catch(() => setSource(null));
  }, [preselected]);

  async function onCode(code: string) {
    setError(null);
    try {
      const label = await fetchLabel(code);
      if (label.status !== "assigned" || !label.node) {
        setError(`${code} n'est affectée à aucun élément.`);
        return;
      }
      if (!source) {
        setSource(label.node);
        return;
      }
      if (label.node.id === source.id) {
        setError("C'est l'élément à déplacer : scannez la destination.");
        return;
      }
      if (label.node.kind === "item") {
        setError("La destination doit être un emplacement ou un contenant, pas un objet.");
        return;
      }
      setDestination(label.node);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lecture impossible.");
    }
  }

  async function confirm() {
    if (!source || !destination) return;
    setBusy(true);
    setError(null);
    try {
      const moved = await api.patch<NodeDetail>(`/nodes/${source.id}`, {
        version: source.version,
        parent_id: destination.id,
      });
      setDone(moved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Déplacement impossible.");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setSource(null);
    setDestination(null);
    setDone(null);
    setError(null);
  }

  if (done) {
    return (
      <section className="card">
        <h2>Déplacé</h2>
        <p>
          <Link to={`/nodes/${done.id}`}>{done.name ?? done.article_name}</Link> est maintenant dans{" "}
          <strong>{path(done).split(" › ").slice(0, -1).join(" › ")}</strong>.
        </p>
        <button type="button" onClick={restart}>
          Déplacer autre chose
        </button>
      </section>
    );
  }

  return (
    <>
      <ol className="steps">
        <li className={source ? "done" : "current"}>
          À déplacer : {source ? <strong>{path(source)}</strong> : "scannez l'objet ou le contenant"}
        </li>
        <li className={destination ? "done" : source ? "current" : ""}>
          Destination : {destination ? <strong>{path(destination)}</strong> : "scannez le nouvel emplacement"}
        </li>
      </ol>
      {error && <p className="error">{error}</p>}
      {source && destination ? (
        <div className="row">
          <button type="button" onClick={confirm} disabled={busy}>
            Confirmer le déplacement
          </button>
          <button type="button" className="secondary" onClick={restart}>
            Recommencer
          </button>
        </div>
      ) : (
        <Scanner
          onCode={onCode}
          hint={source ? "Scannez la destination" : "Scannez l'élément à déplacer"}
        />
      )}
    </>
  );
}
