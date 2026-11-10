/** Géométrie partagée des plans : accrochage à la grille de 5 mm et aux bords des cases voisines. */

export const SNAP = 5; // millimètres
export const MIN_SIZE = 10; // millimètres

export const snap = (v: number) => Math.round(v / SNAP) * SNAP;
export const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;

/** Valeur la plus proche parmi les candidats si elle est à moins de `tolerance`, sinon la grille. */
export function attach(v: number, candidates: number[], tolerance: number): number {
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
  return Math.abs(best - v) <= tolerance ? best : snap(v);
}

/**
 * Position d'une case sur un axe : s'accroche aux murs (0 et max) et aux bords des autres cases
 * (alignement ou contact), à la tolérance près, sinon à la grille. Reste dans le plan.
 */
export function snapAxis(v: number, size: number, max: number, edges: number[], tol: number): number {
  const candidates = [0, max - size];
  for (const edge of edges) candidates.push(edge, edge - size);
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
  const value = Math.abs(best - v) <= tol ? best : snap(v);
  return Math.min(Math.max(0, value), max - size);
}

/** Vrai si deux rectangles se chevauchent (les contacts ne comptent pas). */
export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
