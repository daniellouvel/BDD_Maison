import { useEffect, useState } from "react";
import { api } from "../api";
import type { BoxLayout, NodeDetail } from "../types";
import PlanView, { loadPlanNames } from "./PlanView";

type Found = {
  box: string;
  layout: BoxLayout;
  names: Record<string, string>;
  cell: string;
  level: number;
};

/** Montre sur le plan de la boîte où se trouve un objet (la case qui le contient). */
export default function ItemLocation({ node }: { node: NodeDetail }) {
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    let cancelled = false;
    const chain = node.breadcrumb.map((b) => b.id); // racine … objet
    (async () => {
      // On remonte depuis l'objet : la première boîte dont un étage contient un ancêtre est la bonne.
      for (const id of [...chain].reverse()) {
        if (id === node.id) continue;
        const d = await api.get<NodeDetail>(`/nodes/${id}`).catch(() => null);
        if (!d?.layout?.levels?.length) continue;
        const layout = d.layout;
        const cellIds = layout.levels.flatMap((l) => l.cells.map((c) => c.node_id));
        const cell = chain.find((c) => cellIds.includes(c));
        if (!cell) continue;
        const level = layout.levels.findIndex((l) => l.cells.some((c) => c.node_id === cell));
        const names = await loadPlanNames(id, layout);
        if (!cancelled) setFound({ box: id, layout, names, cell, level: Math.max(0, level) });
        return;
      }
      if (!cancelled) setFound(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [node.id, node.breadcrumb]);

  if (!found) return null;
  const cellName = found.names[found.cell] ?? "cette case";
  return (
    <section className="card">
      <h2>Rangé dans « {cellName} »</h2>
      <PlanView layout={found.layout} names={found.names} highlight={[found.cell]} initialLevel={found.level} />
    </section>
  );
}
