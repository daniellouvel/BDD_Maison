import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { extractCode, fetchLabel } from "../qr";
import type { Node, NodeDetail } from "../types";
import Scanner from "./Scanner";

type Mode = "scan" | "code" | "browse";

/** Choix de l'emplacement d'un objet : scan d'étiquette, saisie du code, ou parcours de l'arbre. */
export default function LocationPicker({
  value,
  onChange,
}: {
  value: NodeDetail | null;
  onChange: (node: NodeDetail | null) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  function accept(node: NodeDetail) {
    if (node.kind === "item") {
      setError("Un objet ne peut pas contenir d'autres éléments : choisissez un emplacement ou un contenant.");
      return;
    }
    setError(null);
    onChange(node);
    setMode(null);
  }

  async function fromCode(raw: string) {
    setError(null);
    const code = extractCode(raw) ?? raw.trim().toUpperCase();
    try {
      const label = await fetchLabel(code);
      if (label.status !== "assigned" || !label.node) {
        setError(`${code} n'est affectée à aucun emplacement.`);
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
          "non localisé (à ranger plus tard)"
        )}
      </p>

      {mode === null && (
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
      <ul className="list">
        {children.map((c) => (
          <li key={c.id} className="row">
            <button
              type="button"
              className="linklike"
              onClick={() => setStack([...stack, { id: c.id, name: c.name ?? "(sans nom)" }])}
            >
              {c.name ?? "(sans nom)"} ›
            </button>
          </li>
        ))}
        {children.length === 0 && <li className="muted">Rien à ce niveau.</li>}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
