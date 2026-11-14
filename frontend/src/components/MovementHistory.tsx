import { useCallback, useEffect, useState } from "react";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import { undoMovement } from "../toast";
import type { MovementEntry } from "../types";

const KIND: Record<string, string> = {
  in: "Ajout",
  out: "Sortie",
  consume: "Consommé",
  adjust: "Ajustement",
  move: "Déplacement",
};

function when(value: string): string {
  const d = new Date(value);
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Qui a fait quoi, quand, sur un article (tous ses lots) ou sur un lot. Le dernier mouvement d'un lot peut s'annuler. */
export default function MovementHistory({ articleId, nodeId, onChanged }: { articleId?: string; nodeId?: string; onChanged?: () => void }) {
  const { canWrite } = useAuth();
  const [rows, setRows] = useState<MovementEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = nodeId ? `node_id=${nodeId}` : `article_id=${articleId}`;
    api
      .get<MovementEntry[]>(`/stock/history?${q}&limit=50`)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Historique indisponible."));
  }, [articleId, nodeId]);

  useEffect(load, [load]);

  if (error) return <p className="error small">{error}</p>;
  if (!rows) return <p className="muted small">Chargement…</p>;
  if (rows.length === 0) return <p className="muted small">Aucun mouvement enregistré.</p>;

  return (
    <ul className="history">
      {rows.map((r) => {
        const place =
          r.kind === "move"
            ? `${(r.from_path ?? []).join(" › ") || "—"} → ${(r.to_path ?? []).join(" › ")}`
            : r.node_path.slice(0, -1).join(" › ");
        const delta = Number(r.delta);
        return (
          <li key={r.id}>
            <span>
              <b>{KIND[r.kind] ?? r.kind}</b>
              {r.kind !== "move" && (
                <span className={delta < 0 ? "neg" : "pos"}>
                  {" "}
                  {delta > 0 ? "+" : ""}
                  {formatQty(String(delta))}
                </span>
              )}
              {r.reason && <span className="muted"> · {r.reason}</span>}
            </span>
            <small className="muted">
              {when(r.created_at)} · {r.actor ?? "?"} · {place}
            </small>
            {canWrite && r.undoable && (
              <button
                type="button"
                className="linklike"
                onClick={async () => {
                  await undoMovement(r.id)();
                  load();
                  onChanged?.();
                }}
              >
                Annuler ce mouvement
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
