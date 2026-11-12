import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { NodeDetail } from "../types";
import PlanView, { loadPlanNames } from "./PlanView";

/** Vrai si l'élément est une boîte dont le plan contient au moins une case. */
export function hasPlan(node: NodeDetail | null | undefined): boolean {
  const levels = node?.layout?.levels;
  return Array.isArray(levels) && levels.some((l) => l.cells.length > 0);
}

/**
 * Choix d'une case : quand on scanne une boîte qui a un plan, on montre le plan et on touche la case
 * voulue. « Toute la boîte » reste possible pour ranger sans préciser la case.
 */
export default function PlanCellPicker({
  box,
  onPick,
  onWhole,
  onCancel,
}: {
  box: NodeDetail;
  onPick: (cell: NodeDetail) => void;
  onWhole: () => void;
  onCancel?: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const boxName = box.name ?? box.article_name ?? "la boîte";

  useEffect(() => {
    if (box.layout) loadPlanNames(box.id, box.layout).then(setNames).catch(() => setNames({}));
  }, [box.id, box.layout]);

  async function pick(id: string) {
    setError(null);
    try {
      onPick(await api.get<NodeDetail>(`/nodes/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Case introuvable.");
    }
  }

  if (!box.layout) return null;
  return (
    <section className="card">
      <h2>Quelle case de « {boxName} » ?</h2>
      <p className="muted small">Touchez la case du plan, ou utilisez la boîte entière.</p>
      <PlanView layout={box.layout} names={names} onCellClick={pick} />
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button type="button" className="secondary" onClick={onWhole}>
          Toute la boîte « {boxName} »
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
    </section>
  );
}
