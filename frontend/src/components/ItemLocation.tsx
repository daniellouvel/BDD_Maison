import { useEffect, useState } from "react";
import { api } from "../api";
import type { BoxLayout, NodeDetail } from "../types";
import PlanView, { loadPlanNames } from "./PlanView";

export type Found = {
  box: string;
  boxName: string;
  layout: BoxLayout;
  names: Record<string, string>;
  /** Case du plan qui contient l'élément (ou l'élément lui-même s'il est une case). */
  cell: string;
  /** Index de l'étage du plan où se trouve cette case. */
  level: number;
};

/**
 * Cherche la boîte à plan où est rangé l'élément : on remonte depuis lui, et la première boîte dont
 * un étage contient l'un de ses ancêtres (ou lui-même) est la bonne. Renvoie null s'il n'est dans aucun plan.
 */
export async function findLocation(node: NodeDetail): Promise<Found | null> {
  const chain = node.breadcrumb.map((b) => b.id); // racine … élément
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
    return { box: id, boxName: d.name ?? "la boîte", layout, names, cell, level: Math.max(0, level) };
  }
  return null;
}

/** Charge la position d'un élément sur le plan de sa boîte (null tant qu'elle n'est pas connue). */
export function useLocation(node: NodeDetail | null): Found | null {
  const [found, setFound] = useState<Found | null>(null);
  const key = node ? `${node.id}|${node.breadcrumb.map((b) => b.id).join(",")}` : "";
  useEffect(() => {
    let cancelled = false;
    setFound(null);
    if (!node) return;
    findLocation(node)
      .then((f) => {
        if (!cancelled) setFound(f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // La position ne change que si l'élément ou son chemin change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return found;
}

/** Montre sur le plan de la boîte où se trouve un élément : la case qui le contient est en surbrillance. */
export default function ItemLocation({ node, onSelect }: { node: NodeDetail; onSelect?: (id: string) => void }) {
  const found = useLocation(node);
  if (!found) return null;
  const cellName = found.names[found.cell] ?? "cette case";
  return (
    <section className="card item-location">
      <h2>
        Rangé dans « {cellName} » <span className="muted small">· {found.boxName}</span>
      </h2>
      <PlanView layout={found.layout} names={found.names} highlight={[found.cell]} initialLevel={found.level} onCellClick={onSelect} />
    </section>
  );
}
