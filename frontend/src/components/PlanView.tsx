import { useState } from "react";
import { api } from "../api";
import type { BoxLayout, Node } from "../types";

/** Noms des étages (enfants de la boîte) et des cases (enfants des étages), pour l'affichage. */
export async function loadPlanNames(box: string, layout: BoxLayout): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const levels = await api.get<Node[]>(`/nodes?parent_id=${box}`).catch(() => [] as Node[]);
  for (const k of levels) if (k.name) names[k.id] = k.name;
  for (const l of layout.levels) {
    if (l.node_id === null) continue; // bloc sans étage : ses cases sont déjà listées par la boîte
    const cells = await api.get<Node[]>(`/nodes?parent_id=${l.node_id}`).catch(() => [] as Node[]);
    for (const k of cells) if (k.name) names[k.id] = k.name;
  }
  return names;
}

/** Plan d'une boîte en lecture : un onglet par étage, cases cliquables et surbrillance optionnelle. */
export default function PlanView({
  layout,
  names,
  highlight = [],
  initialLevel = 0,
  onCellClick,
}: {
  layout: BoxLayout;
  names: Record<string, string>;
  highlight?: string[];
  initialLevel?: number;
  onCellClick?: (cellId: string) => void;
}) {
  const [active, setActive] = useState(initialLevel);
  const levels = layout.levels;
  const level = levels[Math.min(active, levels.length - 1)];
  const W = layout.width_mm;
  const H = layout.height_mm;
  // Traits et textes proportionnels à la taille du plan : sinon, sur une maison, ils deviennent invisibles.
  const unit = Math.max(W, H) / 250;
  const fontSize = unit * 4;

  if (!level) return <p className="muted">Aucun étage dans ce plan.</p>;

  return (
    <div>
      {levels.length > 1 && (
        <div className="tabs">
          {levels.map((l, i) => (
            <button key={l.node_id ?? "base"} type="button" className={i === active ? "" : "secondary"} onClick={() => setActive(i)}>
              {l.node_id === null ? "Dans la boîte" : (names[l.node_id] ?? "Étage")}
            </button>
          ))}
        </div>
      )}
      <svg className="plan" viewBox={`0 0 ${W} ${H}`}>
        <rect x="0" y="0" width={W} height={H} fill="none" stroke="#888" strokeWidth={unit * 1.5} />
        {level.cells.map((c) => {
          const hit = highlight.includes(c.node_id);
          return (
            <g
              key={c.node_id}
              className={`plan-cell${hit ? " plan-hit" : ""}`}
              style={{ cursor: onCellClick ? "pointer" : "default" }}
              onClick={() => onCellClick?.(c.node_id)}
            >
              <rect x={c.x} y={c.y} width={c.w} height={c.h} style={{ strokeWidth: unit }} />
              <text x={c.x + c.w / 2} y={c.y + c.h / 2} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">
                {names[c.node_id] ?? "Case"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
