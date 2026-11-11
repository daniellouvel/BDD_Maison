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

/**
 * Grille de `cols` colonnes × `rows` rangées dans un plan de W × H mm : cases de même taille,
 * séparées par `gap` mm et à `margin` mm des bords.
 *
 * Les bords sont calculés au dixième de mm. Quand deux cases se touchent, la première est raccourcie
 * de 0,01 mm : le serveur compare les bords sans tolérance, et une somme comme 35,7 + 35,7 donne
 * 71,4 ou 71,40000000000001 selon les cas. Ce 0,01 mm reste sous la tolérance de collage du plan.
 * Renvoie null si la grille ne tient pas ou si une case serait plus petite que MIN_SIZE.
 */
export function gridRects(
  W: number,
  H: number,
  cols: number,
  rows: number,
  margin: number,
  gap: number,
): { x: number; y: number; w: number; h: number }[] | null {
  if (![W, H, cols, rows, margin, gap].every(Number.isFinite)) return null;
  if (cols < 1 || rows < 1 || margin < 0 || gap < 0) return null;
  const cw = (W - 2 * margin - (cols - 1) * gap) / cols;
  const ch = (H - 2 * margin - (rows - 1) * gap) / rows;
  if (cw < MIN_SIZE || ch < MIN_SIZE) return null;
  // Bords en dixièmes de mm (entiers), de gauche à droite et de haut en bas.
  const left = (c: number) => Math.round((margin + c * (cw + gap)) * 10);
  const right = (c: number) => Math.round((margin + c * (cw + gap) + cw) * 10);
  const top = (r: number) => Math.round((margin + r * (ch + gap)) * 10);
  const bottom = (r: number) => Math.round((margin + r * (ch + gap) + ch) * 10);
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  // Longueur d'une case en centièmes de mm, de `from` à `to` (dixièmes), sans dépasser `next`
  // (le bord de la case suivante). Si elles se touchent, on retire 0,01 mm.
  const span = (from: number, to: number, next: number | null) => {
    if (next === null || to < next) return (to - from) * 10;
    return (next - from) * 10 - 1;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push({
        x: left(c) / 10,
        y: top(r) / 10,
        w: span(left(c), right(c), c < cols - 1 ? left(c + 1) : null) / 100,
        h: span(top(r), bottom(r), r < rows - 1 ? top(r + 1) : null) / 100,
      });
    }
  }
  return rects;
}

/** Vrai si deux rectangles se chevauchent (les contacts ne comptent pas). */
export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
