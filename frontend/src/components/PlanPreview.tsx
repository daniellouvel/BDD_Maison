import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import type { NodeDetail, PlanModel } from "../types";
import PlanView, { loadPlanNames } from "./PlanView";

/**
 * Plan d'une boîte dans l'explorateur. Sans plan, on affecte un plan existant (bibliothèque
 * « Plans ») ; la création et la modification se font dans l'écran Plan (/plan/:id).
 */
export default function PlanPreview({ node, canWrite, onChanged }: { node: NodeDetail; canWrite: boolean; onChanged: () => void }) {
  const navigate = useNavigate();
  const layout = node.layout && Array.isArray(node.layout.levels) ? node.layout : null;
  const hasPlan = layout !== null && layout.levels.length > 0;
  const [names, setNames] = useState<Record<string, string>>({});
  const [models, setModels] = useState<PlanModel[]>([]);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPlan || !layout) return setNames({});
    let cancelled = false;
    loadPlanNames(node.id, layout).then((found) => {
      if (!cancelled) setNames(found);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, JSON.stringify(layout)]);

  useEffect(() => {
    if (hasPlan || !canWrite) return;
    api.get<PlanModel[]>("/plans").then(setModels).catch(() => setModels([]));
  }, [hasPlan, canWrite]);

  async function apply() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/plans/${chosen}/apply`, { node_id: node.id, node_version: node.version });
      setChosen("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Affectation impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasPlan && !canWrite) return null;

  return (
    <section className="detail-card">
      <div className="row">
        <h3>Plan</h3>
        {canWrite && hasPlan && (
          <button type="button" className="secondary" onClick={() => navigate(`/plan/${node.id}`)}>
            Modifier le plan
          </button>
        )}
      </div>
      {hasPlan && layout ? (
        <PlanView layout={layout} names={names} onCellClick={(cellId) => navigate(`/?n=${cellId}`)} />
      ) : (
        canWrite && (
          <>
            {models.length === 0 ? (
              <p className="muted small">
                Aucun plan enregistré. Créez-en un dans <a href="/plans">Plans</a>, ou tracez directement dans l'écran Plan.
              </p>
            ) : (
              <div className="row">
                <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  <option value="">— choisir un plan existant —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.width_mm} × {m.height_mm} mm)
                    </option>
                  ))}
                </select>
                <button type="button" disabled={!chosen || busy} onClick={apply}>
                  Affecter ce plan
                </button>
              </div>
            )}
            <div className="row">
              <button type="button" className="secondary" onClick={() => navigate(`/plan/${node.id}`)}>
                Tracer directement dans l'écran Plan
              </button>
            </div>
            {error && <p className="error small">{error}</p>}
          </>
        )
      )}
    </section>
  );
}
