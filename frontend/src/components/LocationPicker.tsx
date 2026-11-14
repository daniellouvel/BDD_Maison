import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { fetchLabel, normalizeCode } from "../qr";
import type { BoxLayout, Node, NodeDetail } from "../types";
import PlanCellPicker, { hasPlan } from "./PlanCellPicker";
import PlanView, { loadPlanNames } from "./PlanView";
import Scanner from "./Scanner";

type Mode = "scan" | "code" | "browse";

type PlaceHit = { id: string; name: string; kind: string; path: string[] };
type Recent = { id: string; name: string; path: string };
const RECENT_KEY = "mw_recent_places";

function readRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function rememberPlace(node: NodeDetail) {
  try {
    const path = node.breadcrumb.map((b) => b.name).join(" › ");
    const next = [{ id: node.id, name: node.name ?? node.article_name ?? "Sans nom", path }, ...readRecent().filter((r) => r.id !== node.id)];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, 6)));
  } catch {
    // Mémoire des derniers lieux indisponible : sans gravité.
  }
}

/** Choix de l'emplacement d'un objet : scan d'étiquette, saisie du code, ou parcours de l'arbre. */
export default function LocationPicker({
  value,
  onChange,
  emptyLabel = "non localisé (à ranger plus tard)",
}: {
  value: NodeDetail | null;
  onChange: (node: NodeDetail | null) => void;
  emptyLabel?: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Boîte scannée ou saisie qui a un plan : on laisse choisir la case.
  const [planBox, setPlanBox] = useState<NodeDetail | null>(null);

  function accept(node: NodeDetail) {
    if (node.kind === "item") {
      setError("Un objet ne peut pas contenir d'autres éléments : choisissez un emplacement ou un contenant.");
      return;
    }
    setError(null);
    rememberPlace(node);
    onChange(node);
    setMode(null);
  }

  /** Un lieu choisi par son nom ou dans les derniers : on l'ouvre, et on propose la case s'il a un plan. */
  async function pickById(id: string) {
    setError(null);
    try {
      const node = await api.get<NodeDetail>(`/nodes/${id}`);
      if (hasPlan(node)) {
        setMode(null);
        setPlanBox(node);
      } else {
        accept(node);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lieu introuvable.");
    }
  }

  async function fromCode(raw: string) {
    setError(null);
    const code = normalizeCode(raw) ?? raw.trim().toUpperCase();
    try {
      const label = await fetchLabel(code);
      if (label.status !== "assigned" || !label.node) {
        setError(`${code} n'est affectée à aucun emplacement.`);
        return;
      }
      if (label.node.kind !== "item" && hasPlan(label.node)) {
        setError(null);
        setMode(null);
        setPlanBox(label.node);
        return;
      }
      accept(label.node);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lecture impossible.");
    }
  }

  const path = value ? value.breadcrumb.map((b) => b.name).join(" › ") : null;

  return (
    <div className="location-picker">
      <p>
        Emplacement :{" "}
        {value ? (
          <>
            <strong>{path}</strong>{" "}
            <button type="button" className="linklike" onClick={() => onChange(null)}>
              Retirer
            </button>
          </>
        ) : (
          emptyLabel
        )}
      </p>

      {planBox && (
        <PlanCellPicker
          box={planBox}
          onPick={(cell) => {
            accept(cell);
            setPlanBox(null);
          }}
          onWhole={() => {
            accept(planBox);
            setPlanBox(null);
          }}
          onCancel={() => setPlanBox(null)}
        />
      )}

      {mode === null && !planBox && (
        <PlaceSearch onPick={pickById} />
      )}

      {mode === null && !planBox && (
        <div className="row">
          <button type="button" className="secondary" onClick={() => setMode("scan")}>
            Scanner l'emplacement
          </button>
          <button type="button" className="secondary" onClick={() => setMode("code")}>
            Saisir le code
          </button>
          <button type="button" className="secondary" onClick={() => setMode("browse")}>
            Choisir dans la liste
          </button>
        </div>
      )}

      {mode === "scan" && (
        <>
          <Scanner onCode={fromCode} hint="Scannez l'étiquette de l'emplacement" />
          <button type="button" className="secondary" onClick={() => setMode(null)}>
            Annuler
          </button>
        </>
      )}

      {mode === "code" && <CodeEntry onSubmit={fromCode} onCancel={() => setMode(null)} />}

      {mode === "browse" && <Browse onPick={accept} onCancel={() => setMode(null)} />}

      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Recherche d'un lieu par son nom, et raccourcis vers les derniers lieux utilisés. */
function PlaceSearch({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [answered, setAnswered] = useState("");
  const [recent] = useState<Recent[]>(readRecent);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return setAnswered("");
    }
    const timer = window.setTimeout(() => {
      api
        .get<PlaceHit[]>(`/nodes/find?q=${encodeURIComponent(term)}`)
        .then((list) => {
          setHits(list);
          setAnswered(term);
        })
        .catch(() => setHits([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [q]);

  return (
    <div className="place-search">
      <input type="search" placeholder="Chercher un lieu ou une boîte par son nom…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un lieu" />
      {q.trim() && answered === q.trim() && hits.length === 0 && <p className="muted small">Aucun lieu ne porte ce nom.</p>}
      {hits.length > 0 && (
        <ul className="place-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h.id)}>
                <b>{h.name}</b>
                <small>{h.path.slice(0, -1).join(" › ") || "Racine"}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!q.trim() && recent.length > 0 && (
        <div className="place-recent">
          <span className="muted small">Derniers lieux :</span>
          {recent.map((r) => (
            <button key={r.id} type="button" className="chip" title={r.path} onClick={() => onPick(r.id)}>
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CodeEntry({ onSubmit, onCancel }: { onSubmit: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSubmit(code);
      }}
    >
      <input
        placeholder="Code de l'étiquette, ex. QR-000012"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
      />
      <button type="submit">Valider</button>
      <button type="button" className="secondary" onClick={onCancel}>
        Annuler
      </button>
    </form>
  );
}

/** Parcours de l'arbre des emplacements et contenants, niveau par niveau. */
function Browse({ onPick, onCancel }: { onPick: (node: NodeDetail) => void; onCancel: () => void }) {
  // Pile des niveaux ouverts : le premier élément est la racine (null).
  const [stack, setStack] = useState<{ id: string; name: string }[]>([]);
  const [children, setChildren] = useState<Node[]>([]);
  const [error, setError] = useState<string | null>(null);

  const currentId = stack.length ? stack[stack.length - 1].id : null;
  const [plan, setPlan] = useState<{ layout: BoxLayout; names: Record<string, string> } | null>(null);

  // Si le niveau ouvert est une boîte avec un plan, on propose de cliquer une case.
  useEffect(() => {
    setPlan(null);
    if (!currentId) return;
    api
      .get<NodeDetail>(`/nodes/${currentId}`)
      .then(async (d) => {
        if (d.layout && d.layout.levels?.length) {
          setPlan({ layout: d.layout, names: await loadPlanNames(currentId, d.layout) });
        }
      })
      .catch(() => setPlan(null));
  }, [currentId]);

  useEffect(() => {
    setError(null);
    const url = currentId ? `/nodes?parent_id=${currentId}` : "/nodes";
    api
      .get<Node[]>(url)
      .then((list) => setChildren(list.filter((n) => n.kind !== "item")))
      .catch(() => setError("Liste impossible à charger."));
  }, [currentId]);

  async function choose(id: string) {
    try {
      onPick(await api.get<NodeDetail>(`/nodes/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sélection impossible.");
    }
  }

  return (
    <div>
      <p className="muted">
        {stack.length ? stack.map((s) => s.name).join(" › ") : "Racine"}
      </p>
      <div className="row">
        {stack.length > 0 && (
          <button type="button" className="secondary" onClick={() => setStack(stack.slice(0, -1))}>
            ← Niveau au-dessus
          </button>
        )}
        {currentId && (
          <button type="button" onClick={() => choose(currentId)}>
            Choisir « {stack[stack.length - 1].name} »
          </button>
        )}
        <button type="button" className="secondary" onClick={onCancel}>
          Annuler
        </button>
      </div>
      {plan && (
        <>
          <p className="muted small">Touchez une case du plan pour la choisir.</p>
          <PlanView layout={plan.layout} names={plan.names} onCellClick={choose} />
        </>
      )}
      <ul className="list">
        {children.map((c) => (
          <li key={c.id} className="row">
            <button type="button" className="linklike" onClick={() => choose(c.id)}>
              Choisir « {c.name ?? "(sans nom)"} »
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setStack([...stack, { id: c.id, name: c.name ?? "(sans nom)" }])}
            >
              Ouvrir ›
            </button>
          </li>
        ))}
        {children.length === 0 && <li className="muted">Rien à ce niveau.</li>}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
