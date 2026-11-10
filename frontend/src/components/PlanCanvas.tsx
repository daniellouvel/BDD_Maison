import { useRef, useState, type PointerEvent } from "react";
import { MIN_SIZE, SNAP, attach, clamp, round1, snapAxis } from "./planGeometry";

/**
 * Surface de tracé d'un plan (boîte ou modèle), partagée entre les écrans.
 *
 * Règles du pointeur :
 * - glisser depuis une zone vide, ou depuis le bord d'une case, trace une nouvelle case ;
 * - glisser depuis l'intérieur d'une case la déplace (elle est sélectionnée) ;
 * - glisser une poignée de la case sélectionnée la redimensionne ;
 * - un simple clic sélectionne la case visée.
 * Toute position qui chevauche une autre case ou sort du plan est refusée.
 */

export type CanvasRect = { x: number; y: number; w: number; h: number };

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

const overlaps = (a: CanvasRect, b: CanvasRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

type Op =
  | { kind: "move"; index: number; start: { x: number; y: number }; orig: CanvasRect; moved: boolean; result: Result | null }
  | { kind: "resize"; index: number; handle: Handle; start: { x: number; y: number }; orig: CanvasRect; moved: boolean; result: Result | null }
  | { kind: "draw"; start: { x: number; y: number }; moved: boolean; rect: CanvasRect | null; clickIndex: number };

/** Case voisine entraînée par le bord déplacé : elle partage ce bord avec la case redimensionnée. */
type Moved = CanvasRect & { index: number };
type Result = CanvasRect & { valid: boolean; extra: Moved[] };

const EPS = 0.05; // tolérance pour considérer deux bords comme confondus (mm)

/**
 * Voisins qui partagent un bord de la case redimensionnée : quand ce bord bouge, leur bord commun
 * suit. Un voisin n'est concerné que s'il touche le bord d'origine sur toute sa portée commune.
 */
function edgeFollowers(orig: CanvasRect, rect: CanvasRect, cells: CanvasRect[], skip: number, handle: string): Moved[] {
  const origRight = orig.x + orig.w;
  const origBottom = orig.y + orig.h;
  const newRight = rect.x + rect.w;
  const newBottom = rect.y + rect.h;
  const movesLeft = handle.includes("w") && rect.x !== orig.x;
  const movesRight = handle.includes("e") && newRight !== origRight;
  const movesTop = handle.startsWith("n") && rect.y !== orig.y;
  const movesBottom = handle.startsWith("s") && newBottom !== origBottom;
  const out: Moved[] = [];
  cells.forEach((c, i) => {
    if (i === skip) return;
    const vOverlap = c.y < origBottom - EPS && orig.y < c.y + c.h - EPS;
    const hOverlap = c.x < origRight - EPS && orig.x < c.x + c.w - EPS;
    let { x, y, w, h } = c;
    let changed = false;
    if (movesLeft && vOverlap && Math.abs(c.x + c.w - orig.x) < EPS) {
      w = rect.x - c.x;
      changed = true;
    }
    if (movesRight && vOverlap && Math.abs(c.x - origRight) < EPS) {
      x = newRight;
      w = c.x + c.w - newRight;
      changed = true;
    }
    if (movesTop && hOverlap && Math.abs(c.y + c.h - orig.y) < EPS) {
      h = rect.y - c.y;
      changed = true;
    }
    if (movesBottom && hOverlap && Math.abs(c.y - origBottom) < EPS) {
      y = newBottom;
      h = c.y + c.h - newBottom;
      changed = true;
    }
    if (changed) out.push({ index: i, x, y, w, h });
  });
  return out;
}

export default function PlanCanvas<T extends CanvasRect>({
  W,
  H,
  cells,
  selected,
  readOnly = false,
  pending = null,
  label,
  color,
  onSelect,
  onChange,
  onDraw,
  onError,
}: {
  W: number;
  H: number;
  cells: T[];
  selected: number | null;
  readOnly?: boolean;
  /** Zone tracée en attente d'un choix (contenant), affichée en pointillés. */
  pending?: CanvasRect | null;
  label: (index: number) => string;
  color: (index: number) => string;
  onSelect: (index: number | null) => void;
  onChange: (cells: T[]) => void;
  onDraw: (rect: CanvasRect) => void;
  onError: (message: string) => void;
}) {
  const surface = useRef<SVGSVGElement>(null);
  const op = useRef<Op | null>(null);
  const [preview, setPreview] = useState<(Result & { index: number }) | null>(null);
  const [drawing, setDrawing] = useState<CanvasRect | null>(null);

  // Traits et textes proportionnels à la taille du plan ; marge pour les axes.
  const unit = Math.max(W, H) / 250;
  const fontSize = unit * 4;
  const M = unit * 14;
  const step = [10, 20, 50, 100].find((s) => Math.max(W, H) / s <= 20) ?? 100;
  const ticksX: number[] = [];
  for (let v = 0; v <= W + 0.001; v += step) ticksX.push(v);
  const ticksY: number[] = [];
  for (let v = 0; v <= H + 0.001; v += step) ticksY.push(v);
  let gridPath = "";
  for (let v = 0; v <= W + 0.001; v += SNAP) gridPath += `M${v} 0V${H}`;
  for (let v = 0; v <= H + 0.001; v += SNAP) gridPath += `M0 ${v}H${W}`;

  /** Point sous le curseur en mm, sans accrochage, et tolérances de 10 px en mm. */
  function pointMm(e: PointerEvent<SVGSVGElement>) {
    const r = surface.current!.getBoundingClientRect();
    const sx = (W + 2 * M) / r.width;
    const sy = (H + 2 * M) / r.height;
    return { x: (e.clientX - r.left) * sx - M, y: (e.clientY - r.top) * sy - M, tolX: sx * 10, tolY: sy * 10 };
  }

  /** Point accroché aux bords du plan et des cases, à 10 px près, sinon à la grille. */
  function snapPoint(e: PointerEvent<SVGSVGElement>, skip = -1) {
    const p = pointMm(e);
    const xs = [0, W];
    const ys = [0, H];
    cells.forEach((c, i) => {
      if (i === skip) return;
      xs.push(c.x, c.x + c.w);
      ys.push(c.y, c.y + c.h);
    });
    return { x: attach(clamp(p.x, W), xs, p.tolX), y: attach(clamp(p.y, H), ys, p.tolY) };
  }

  /** Poignée touchée sur une case, dans un rayon de `half` mm autour de son centre. */
  function handleAt(p: { x: number; y: number }, c: CanvasRect, half: number): Handle | null {
    for (const h of HANDLES) {
      const px = h.includes("w") ? c.x : h.includes("e") ? c.x + c.w : c.x + c.w / 2;
      const py = h.startsWith("n") ? c.y : h.startsWith("s") ? c.y + c.h : c.y + c.h / 2;
      if (Math.abs(p.x - px) <= half && Math.abs(p.y - py) <= half) return h;
    }
    return null;
  }

  const inside = (p: { x: number; y: number }, c: CanvasRect, band: number) =>
    p.x >= c.x - band && p.x <= c.x + c.w + band && p.y >= c.y - band && p.y <= c.y + c.h + band;
  const interior = (p: { x: number; y: number }, c: CanvasRect, band: number) =>
    p.x > c.x + band && p.x < c.x + c.w - band && p.y > c.y + band && p.y < c.y + c.h - band;

  function onDown(e: PointerEvent<SVGSVGElement>) {
    const p = pointMm(e);
    const band = Math.max(p.tolX, p.tolY) * 0.6; // bord de 6 px : traité comme le vide
    const half = Math.max(p.tolX, p.tolY) * 0.9; // poignée de 9 px
    const capture = () => e.currentTarget.setPointerCapture(e.pointerId);

    if (!readOnly && selected !== null && cells[selected]) {
      const c = cells[selected];
      const handle = handleAt(p, c, half);
      if (handle) {
        op.current = { kind: "resize", index: selected, handle, start: p, orig: c, moved: false, result: null };
        return capture();
      }
      if (interior(p, c, band)) {
        op.current = { kind: "move", index: selected, start: p, orig: c, moved: false, result: null };
        return capture();
      }
    }

    // Intérieur d'une autre case : on la sélectionne et on peut la déplacer.
    const hit = cells.findIndex((c) => interior(p, c, band));
    if (hit >= 0 && !readOnly) {
      onSelect(hit);
      op.current = { kind: "move", index: hit, start: p, orig: cells[hit], moved: false, result: null };
      return capture();
    }

    // Zone vide ou bord d'une case : tracé d'une nouvelle case (un clic seul sélectionne).
    const clickIndex = cells.findIndex((c) => inside(p, c, band));
    const start = snapPoint(e);
    op.current = { kind: "draw", start, moved: false, rect: null, clickIndex };
    capture();
  }

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const o = op.current;
    if (!o) return;
    const p = pointMm(e);

    if (o.kind === "move") {
      const dx = p.x - o.start.x;
      const dy = p.y - o.start.y;
      if (!o.moved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      o.moved = true;
      const others = cells.filter((_, i) => i !== o.index);
      const { w, h } = o.orig;
      const x = snapAxis(o.orig.x + dx, w, W, others.flatMap((c) => [c.x, c.x + c.w]), p.tolX);
      const y = snapAxis(o.orig.y + dy, h, H, others.flatMap((c) => [c.y, c.y + c.h]), p.tolY);
      const valid = !others.some((c) => overlaps({ x, y, w, h }, c));
      o.result = { x, y, w, h, valid, extra: [] };
      setPreview({ index: o.index, ...o.result });
      return;
    }

    if (o.kind === "resize") {
      const dx = Math.abs(p.x - o.start.x);
      const dy = Math.abs(p.y - o.start.y);
      if (!o.moved && dx < 1 && dy < 1) return;
      o.moved = true;
      const others = cells.filter((_, i) => i !== o.index);
      const xs = [0, W, ...others.flatMap((c) => [c.x, c.x + c.w])];
      const ys = [0, H, ...others.flatMap((c) => [c.y, c.y + c.h])];
      const sx = attach(clamp(p.x, W), xs, p.tolX);
      const sy = attach(clamp(p.y, H), ys, p.tolY);
      let left = o.orig.x;
      let right = o.orig.x + o.orig.w;
      let top = o.orig.y;
      let bottom = o.orig.y + o.orig.h;
      if (o.handle.includes("w")) left = sx;
      if (o.handle.includes("e")) right = sx;
      if (o.handle.startsWith("n")) top = sy;
      if (o.handle.startsWith("s")) bottom = sy;
      if (right - left < MIN_SIZE) {
        if (o.handle.includes("w")) left = right - MIN_SIZE;
        else right = left + MIN_SIZE;
      }
      if (bottom - top < MIN_SIZE) {
        if (o.handle.startsWith("n")) top = bottom - MIN_SIZE;
        else bottom = top + MIN_SIZE;
      }
      const rect = { x: left, y: top, w: right - left, h: bottom - top };
      // Les voisins qui partagent le bord déplacé suivent ; chacun doit rester valide.
      const extra = edgeFollowers(o.orig, rect, cells, o.index, o.handle);
      const after = cells.map((c, i) => (i === o.index ? rect : (extra.find((e) => e.index === i) ?? c)));
      const changed = [o.index, ...extra.map((e) => e.index)];
      const inPlan = (r: CanvasRect) => r.x >= -EPS && r.y >= -EPS && r.x + r.w <= W + EPS && r.y + r.h <= H + EPS;
      const valid =
        changed.every((i) => {
          const r = after[i];
          return inPlan(r) && r.w >= MIN_SIZE - EPS && r.h >= MIN_SIZE - EPS && after.every((c, j) => j === i || !overlaps(r, c));
        });
      o.result = { ...rect, valid, extra };
      setPreview({ index: o.index, ...o.result });
      return;
    }

    // Tracé d'une nouvelle case.
    const now = snapPoint(e);
    const dx = Math.abs(now.x - o.start.x);
    const dy = Math.abs(now.y - o.start.y);
    if (!o.moved && dx < 1 && dy < 1) return;
    o.moved = true;
    o.rect = { x: Math.min(o.start.x, now.x), y: Math.min(o.start.y, now.y), w: dx, h: dy };
    setDrawing(o.rect);
  }

  function onUp() {
    const o = op.current;
    op.current = null;
    setPreview(null);
    setDrawing(null);
    if (!o) return;

    if (o.kind === "draw") {
      if (!o.moved || !o.rect) return onSelect(o.clickIndex >= 0 ? o.clickIndex : null);
      const r = { x: round1(o.rect.x), y: round1(o.rect.y), w: round1(o.rect.w), h: round1(o.rect.h) };
      if (r.w < MIN_SIZE || r.h < MIN_SIZE || readOnly) return;
      if (cells.some((c) => overlaps(r, c))) return onError("Cette zone chevauche une case existante.");
      return onDraw(r);
    }

    if (!o.moved || !o.result) return onSelect(o.index);
    const m = o.result;
    if (!m.valid) return onError("Cette case ne peut pas aller là : elle chevauche une autre case ou sort du plan.");
    if (m.x === o.orig.x && m.y === o.orig.y && m.w === o.orig.w && m.h === o.orig.h && m.extra.length === 0) return;
    const next = cells.map((c, i) => {
      if (i === o.index) return { ...c, x: m.x, y: m.y, w: m.w, h: m.h };
      const f = m.extra.find((e) => e.index === i);
      return f ? { ...c, x: f.x, y: f.y, w: f.w, h: f.h } : c;
    });
    onChange(next);
  }

  /** Case affichée : position provisoire pendant un déplacement ou un redimensionnement. */
  const shown = (i: number, c: CanvasRect): CanvasRect => {
    if (preview && preview.index === i) return preview;
    const f = preview?.extra.find((e) => e.index === i);
    return f ?? c;
  };

  return (
    <>
      <svg
        ref={surface}
        className="plan-svg"
        viewBox={`${-M} ${-M} ${W + 2 * M} ${H + 2 * M}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <path d={gridPath} fill="none" stroke="#888" strokeOpacity="0.2" strokeWidth={unit * 0.4} />
        <path
          d={[...ticksX.map((v) => `M${v} 0V${-unit * 1.5}`), ...ticksY.map((v) => `M0 ${v}H${-unit * 1.5}`)].join("")}
          stroke="#888"
          strokeWidth={unit * 0.8}
        />
        {ticksX.map((v) => (
          <text key={`x${v}`} x={v} y={-unit * 4} textAnchor="middle" fontSize={fontSize} fill="#888">
            {v}
          </text>
        ))}
        {ticksY.map((v) => (
          <text key={`y${v}`} x={-unit * 2.5} y={v} textAnchor="end" dominantBaseline="middle" fontSize={fontSize} fill="#888">
            {v}
          </text>
        ))}
        <rect x="0" y="0" width={W} height={H} fill="none" stroke="#888" strokeWidth={unit * 1.5} />

        {cells.map((c, i) => {
          const p = shown(i, c);
          const isSel = selected === i;
          const bad = preview && preview.index === i && !preview.valid;
          const col = color(i);
          return (
            <g key={i} className={`plan-cell${isSel ? " plan-selected" : ""}`} style={{ cursor: readOnly ? "default" : "move" }}>
              <rect
                x={p.x}
                y={p.y}
                width={p.w}
                height={p.h}
                style={{
                  fill: col,
                  fillOpacity: isSel || (preview && preview.index === i) ? 0.45 : 0.22,
                  stroke: bad ? "#ef4444" : col,
                  strokeWidth: unit * (isSel ? 2 : 1),
                }}
              />
              <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">
                {label(i)}
              </text>
              <text x={p.x + p.w / 2} y={p.y + p.h - unit * 2} fontSize={fontSize * 0.7} textAnchor="middle" opacity={0.7}>
                {round1(p.w)} × {round1(p.h)}
              </text>
            </g>
          );
        })}

        {!readOnly &&
          selected !== null &&
          cells[selected] &&
          (() => {
            const p = shown(selected, cells[selected]);
            const hs = unit * 3;
            return HANDLES.map((h) => {
              const px = h.includes("w") ? p.x : h.includes("e") ? p.x + p.w : p.x + p.w / 2;
              const py = h.startsWith("n") ? p.y : h.startsWith("s") ? p.y + p.h : p.y + p.h / 2;
              return (
                <rect
                  key={h}
                  className="plan-handle"
                  x={px - hs / 2}
                  y={py - hs / 2}
                  width={hs}
                  height={hs}
                  style={{ cursor: HANDLE_CURSOR[h], strokeWidth: unit * 0.6 }}
                />
              );
            });
          })()}

        {drawing && <rect className="plan-draft" x={drawing.x} y={drawing.y} width={drawing.w} height={drawing.h} style={{ strokeWidth: unit }} />}
        {pending && !drawing && (
          <rect className="plan-draft" x={pending.x} y={pending.y} width={pending.w} height={pending.h} style={{ strokeWidth: unit }} />
        )}
      </svg>
    </>
  );
}
