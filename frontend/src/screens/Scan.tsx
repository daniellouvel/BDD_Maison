import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import PlanCellPicker, { hasPlan } from "../components/PlanCellPicker";
import Scanner from "../components/Scanner";
import { fetchLabel } from "../qr";
import type { Label, NodeDetail } from "../types";

type Mode = "open" | "move" | "serie";

const path = (n: NodeDetail) => n.breadcrumb.map((b) => b.name).join(" › ");

export default function Scan() {
  const [params, setParams] = useSearchParams();
  const { canWrite } = useAuth();
  const raw = params.get("mode");
  const mode: Mode = raw === "move" ? "move" : raw === "serie" ? "serie" : "open";
  const preselected = params.get("source");

  return (
    <>
      <div className="tabs">
        <button type="button" className={mode === "open" ? "" : "secondary"} onClick={() => setParams({})}>
          Ouvrir
        </button>
        {canWrite && (
          <>
            <button
              type="button"
              className={mode === "move" ? "" : "secondary"}
              onClick={() => setParams({ mode: "move" })}
            >
              Déplacer
            </button>
            <button
              type="button"
              className={mode === "serie" ? "" : "secondary"}
              onClick={() => setParams({ mode: "serie" })}
            >
              Ranger en série
            </button>
          </>
        )}
      </div>
      {mode === "open" && <OpenMode />}
      {mode === "move" && <MoveMode key={preselected ?? "scan"} preselected={preselected} />}
      {mode === "serie" && <SerieMode />}
    </>
  );
}

/** Ranger en série : on scanne une destination, puis chaque objet qui y va, un par un. */
function SerieMode() {
  const [dest, setDest] = useState<NodeDetail | null>(null);
  const [planBox, setPlanBox] = useState<NodeDetail | null>(null);
  const [log, setLog] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCode(code: string) {
    setError(null);
    try {
      const label = await fetchLabel(code);
      if (label.status !== "assigned" || !label.node) {
        setError(`${code} n'est affectée à aucun élément.`);
        return;
      }
      const node = label.node;
      const name = node.name ?? node.article_name ?? "Objet";
      // Un lieu ou un contenant scanné devient la destination ; un objet est rangé dedans.
      if (node.kind !== "item") {
        if (hasPlan(node)) setPlanBox(node);
        else setDest(node);
        return;
      }
      if (!dest) {
        setError("Scannez d'abord la destination (un emplacement ou un contenant).");
        return;
      }
      if (node.parent_id === dest.id) {
        setLog((l) => [{ name, ok: true, text: "déjà là" }, ...l]);
        return;
      }
      setBusy(true);
      await api.patch(`/nodes/${node.id}`, { version: node.version, parent_id: dest.id });
      setLog((l) => [{ name, ok: true, text: `rangé dans ${dest.name ?? dest.article_name}` }, ...l]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Rangement impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (planBox) {
    return (
      <PlanCellPicker
        box={planBox}
        onPick={(cell) => {
          setDest(cell);
          setPlanBox(null);
        }}
        onWhole={() => {
          setDest(planBox);
          setPlanBox(null);
        }}
        onCancel={() => setPlanBox(null)}
      />
    );
  }

  if (!dest) {
    return (
      <>
        <p className="muted">Scannez d'abord la destination (boîte, tiroir, étagère…).</p>
        <Scanner onCode={onCode} hint="Scannez la destination" />
        {error && <p className="error">{error}</p>}
      </>
    );
  }

  return (
    <>
      <section className="card">
        <p className="muted small">Destination</p>
        <h2>{dest.name ?? dest.article_name}</h2>
        <p className="muted small">{path(dest)}</p>
        <button type="button" className="secondary" onClick={() => setDest(null)}>
          Changer de destination
        </button>
      </section>
      <p className="muted small">
        Scannez chaque objet à ranger ici. Scanner un autre lieu le fait devenir la destination.
      </p>
      <Scanner onCode={onCode} hint={busy ? "Rangement…" : "Scannez un objet"} />
      {error && <p className="error">{error}</p>}
      {log.length > 0 && (
        <ul className="list">
          {log.map((l, i) => (
            <li key={i}>
              {l.ok ? "✓" : "✗"} {l.name} <span className="muted small">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
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
          <p className="muted">Cette étiquette n'est encore collée sur rien. Que voulez-vous en faire ?</p>
          <div className="row">
            <Link className="button" to={`/ranger?label=${label.code}`}>
              Ranger un nouvel objet avec elle
            </Link>
            <Link className="button secondary" to={`/qr/labels/${label.code}`}>
              L'affecter à un élément existant
            </Link>
          </div>
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
  // Boîte scannée qui a un plan : on laisse choisir la case avant de confirmer.
  const [planBox, setPlanBox] = useState<NodeDetail | null>(null);
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
      if (hasPlan(label.node)) setPlanBox(label.node);
      else setDestination(label.node);
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
    setPlanBox(null);
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
      {planBox ? (
        <PlanCellPicker
          box={planBox}
          onPick={(cell) => {
            setDestination(cell);
            setPlanBox(null);
          }}
          onWhole={() => {
            setDestination(planBox);
            setPlanBox(null);
          }}
          onCancel={() => setPlanBox(null)}
        />
      ) : source && destination ? (
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
