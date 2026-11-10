import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { NodeDetail } from "../types";
import PlanView, { loadPlanNames } from "./PlanView";

/**
 * Aperçu en lecture seule du plan d'une boîte, dans l'explorateur. La création et la modification
 * se font dans l'écran séparé « Plan » (/plan/:id), pour ne pas encombrer cette vue.
 */
export default function PlanPreview({ node, canWrite }: { node: NodeDetail; canWrite: boolean }) {
  const navigate = useNavigate();
  const layout = node.layout && Array.isArray(node.layout.levels) ? node.layout : null;
  const hasPlan = layout !== null && layout.levels.length > 0;
  const [names, setNames] = useState<Record<string, string>>({});

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

  if (!hasPlan && !canWrite) return null;

  return (
    <section className="detail-card">
      <div className="row">
        <h3>Plan</h3>
        {canWrite && (
          <button type="button" className="secondary" onClick={() => navigate(`/plan/${node.id}`)}>
            {hasPlan ? "Modifier le plan" : "Créer le plan"}
          </button>
        )}
      </div>
      {hasPlan && layout ? (
        <PlanView layout={layout} names={names} />
      ) : (
        <p className="muted small">Pas encore de plan pour cette boîte.</p>
      )}
    </section>
  );
}
