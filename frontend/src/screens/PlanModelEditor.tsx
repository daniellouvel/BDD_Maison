import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { MIN_SIZE, SNAP, attach, clamp, round1, snapAxis } from "../components/planGeometry";
import type { PlanCell, PlanModel } from "../types";

/**
 * Éditeur d'un modèle de plan (écran Plans). Même tracé que le plan d'un contenant, mais les
 * modifications restent en brouillon jusqu'à « Enregistrer » : un modèle ne crée rien dans la base
 * tant qu'il n'est pas affecté à un contenant.
 */

type Rect = { x: number; y: number; w: number; h: number };
type Drag = { index: number; start: { x: number; y: number }; orig: PlanCell; moved: boolean; result: { x: number; y: number; valid: boolean } | null };

const overlapsRect = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export default function PlanModelEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [saved, setSaved] = useState<PlanModel | null>(null);
  const [draft, setDraft] = useState<PlanModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [dims, setDims] = useState({ width: "", height: "" });
  const [cellForm, setCellForm] = useState({ name: "", x: "", y: "", w: "", h: "" });
  const [newLevel, setNewLevel] = useState("");
  const [drawing, setDrawing] = useState<Rect | null>(null);
  const [moving, setMoving] = useState<{ index: number; x: number; y: number; w: number; h: number; valid: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const surface = useRef<SVGSVGElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Tracé en cours, lu au relâchement (l'état peut être en retard sur un glissé rapide).
  const drawRef = useRef<Rect | null>(null);
  const dragCell = useRef<Drag | null>(null);

  const load = useCallback(async () => {
    try {
      const model = await api.get<PlanModel>(`/plans/${id}`);
      setSaved(model);
      setDraft(model);
      setDims({ width: String(model.width_mm), height: String(model.height_mm) });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Modèle introuvable.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const levels = draft?.levels ?? [];
  const level = levels[Math.min(active, levels.length - 1)] ?? null;
  const cells = level?.cells ?? [];
  const W = draft?.width_mm ?? 300;
  const H = draft?.height_mm ?? 200;
  const unit = Math.max(W, H) / 250;
  const fontSize = unit * 4;
  const M = unit * 14;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const selectedCell = selected !== null ? cells[selected] ?? null : null;

  // Le formulaire de la case suit la case sélectionnée.
  useEffect(() => {
    if (!selectedCell) return;
    setCellForm({
      name: selectedCell.name ?? "",
      x: String(selectedCell.x),
      y: String(selectedCell.y),
      w: String(selectedCell.w),
      h: String(selectedCell.h),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, draft]);

  /** Modifie le brouillon ; le plan n'est enregistré qu'avec le bouton. */
  function edit(fn: (model: PlanModel) => PlanModel) {
    setDraft((d) => (d ? fn(d) : d));
    setMessage(null);
  }

  function updateLevel(index: number, fn: (cellsList: PlanCell[]) => PlanCell[]) {
    edit((d) => ({ ...d, levels: d.levels.map((l, i) => (i === index ? { ...l, cells: fn(l.cells) } : l)) }));
  }

  async function save() {
    if (!draft || !saved) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: draft.name,
        width_mm: draft.width_mm,
        height_mm: draft.height_mm,
        levels: draft.levels.map((l) => ({
          name: l.name,
          cells: l.cells.map((c) => ({ name: c.name, x: c.x, y: c.y, w: c.w, h: c.h })),
        })),
        version: saved.version,
      };
      const model = await api.put<PlanModel>(`/plans/${id}`, body);
      setSaved(model);
      setDraft(model);
      setMessage("Modèle enregistré.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!window.confirm("Supprimer ce modèle ? Les contenants déjà affectés gardent leur plan.")) return;
    try {
      await api.del(`/plans/${id}`);
      navigate("/plans");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Suppression impossible.");
    }
  }

  function applyDims() {
    const width = Number(dims.width);
    const height = Number(dims.height);
    if (!(width > 0 && height > 0)) return setError("Dimensions invalides.");
    const tooBig = (draft?.levels ?? []).some((l) => l.cells.some((c) => c.x + c.w > width || c.y + c.h > height));
    if (tooBig) return setError("Une case dépasse les nouvelles dimensions : déplacez-la ou réduisez-la d'abord.");
    setError(null);
    edit((d) => ({ ...d, width_mm: width, height_mm: height }));
  }

  function applyCell() {
    if (selected === null || !level) return;
    const x = Number(cellForm.x);
    const y = Number(cellForm.y);
    const w = Number(cellForm.w);
    const h = Number(cellForm.h);
    if (![x, y, w, h].every(Number.isFinite) || w < MIN_SIZE || h < MIN_SIZE) {
      return setError(`Dimensions invalides (minimum ${MIN_SIZE} mm).`);
    }
    if (x < 0 || y < 0 || x + w > W || y + h > H) return setError("La case sort du plan.");
    const rect = { x, y, w, h };
    if (cells.some((c, i) => i !== selected && overlapsRect(rect, c))) return setError("Cette case chevauche une autre case.");
    setError(null);
    const index = selected;
    updateLevel(Math.min(active, levels.length - 1), (list) =>
      list.map((c, i) => (i === index ? { ...c, name: cellForm.name.trim() || null, x, y, w, h } : c)),
    );
  }

  function removeCell() {
    if (selected === null) return;
    const index = selected;
    updateLevel(Math.min(active, levels.length - 1), (list) => list.filter((_, i) => i !== index));
    setSelected(null);
  }

  function addLevel() {
    edit((d) => ({ ...d, levels: [...d.levels, { name: newLevel.trim() || `Étage ${d.levels.length + 1}`, cells: [] }] }));
    setActive(levels.length);
    setNewLevel("");
  }

  function removeLevel() {
    if (!level || level.cells.length > 0) return setError("Retirez d'abord les cases de cet étage.");
    const index = Math.min(active, levels.length - 1);
    edit((d) => ({ ...d, levels: d.levels.filter((_, i) => i !== index) }));
    setActive(0);
  }

  /** Point sous le curseur en mm, sans accrochage, avec la tolérance de 10 px en mm. */
  function pointMm(e: PointerEvent<SVGSVGElement>) {
    const r = surface.current!.getBoundingClientRect();
    const sx = (W + 2 * M) / r.width;
    const sy = (H + 2 * M) / r.height;
    return { x: (e.clientX - r.left) * sx - M, y: (e.clientY - r.top) * sy - M, tolX: sx * 10, tolY: sy * 10 };
  }

  /** Point accroché : bords du plan et des cases de l'étage, sinon grille de 5 mm. */
  function toMm(e: PointerEvent<SVGSVGElement>) {
    const p = pointMm(e);
    const xs = [0, W];
    const ys = [0, H];
    for (const c of cells) {
      xs.push(c.x, c.x + c.w);
      ys.push(c.y, c.y + c.h);
    }
    return { x: attach(clamp(p.x, W), xs, p.tolX), y: attach(clamp(p.y, H), ys, p.tolY) };
  }

  function onDown(e: PointerEvent<SVGSVGElement>) {
    const el = (e.target as Element).closest?.("[data-cell]");
    if (el) {
      const index = Number(el.getAttribute("data-cell"));
      setSelected(index);
      const orig = cells[index];
      if (orig && !busy) {
        dragCell.current = { index, start: pointMm(e), orig, moved: false, result: null };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    setSelected(null);
    if (!level) return;
    origin.current = toMm(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    drawRef.current = { x: origin.current.x, y: origin.current.y, w: 0, h: 0 };
    setDrawing(drawRef.current);
  }

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const dc = dragCell.current;
    if (dc) {
      const p = pointMm(e);
      const dx = p.x - dc.start.x;
      const dy = p.y - dc.start.y;
      if (!dc.moved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      dc.moved = true;
      const others = cells.filter((_, i) => i !== dc.index);
      const { w, h } = dc.orig;
      const x = snapAxis(dc.orig.x + dx, w, W, others.flatMap((c) => [c.x, c.x + c.w]), p.tolX);
      const y = snapAxis(dc.orig.y + dy, h, H, others.flatMap((c) => [c.y, c.y + c.h]), p.tolY);
      const valid = !others.some((c) => overlapsRect({ x, y, w, h }, c));
      dc.result = { x, y, valid };
      setMoving({ index: dc.index, x, y, w, h, valid });
      return;
    }
    const o = origin.current;
    if (!o) return;
    const p = toMm(e);
    drawRef.current = { x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) };
    setDrawing(drawRef.current);
  }

  function onUp() {
    const dc = dragCell.current;
    if (dc) {
      dragCell.current = null;
      setMoving(null);
      const m = dc.result;
      if (!dc.moved || !m) return;
      if (!m.valid) return setError("Cette case ne peut pas aller là : elle chevauche une autre case.");
      if (m.x === dc.orig.x && m.y === dc.orig.y) return;
      setError(null);
      updateLevel(Math.min(active, levels.length - 1), (list) =>
        list.map((c, i) => (i === dc.index ? { ...c, x: m.x, y: m.y } : c)),
      );
      return;
    }
    const rect = drawRef.current;
    drawRef.current = null;
    origin.current = null;
    setDrawing(null);
    if (!rect || !level) return;
    const r: Rect = { x: round1(rect.x), y: round1(rect.y), w: round1(rect.w), h: round1(rect.h) };
    if (r.w < MIN_SIZE || r.h < MIN_SIZE) return;
    if (cells.some((c) => overlapsRect(r, c))) return setError("Cette zone chevauche une case existante.");
    setError(null);
    const index = cells.length;
    updateLevel(Math.min(active, levels.length - 1), (list) => [...list, { name: null, ...r }]);
    setSelected(index);
  }

  if (loadError) return <p className="error">{loadError}</p>;
  if (!draft) return <p className="muted">Chargement…</p>;

  const step = [10, 20, 50, 100].find((s) => Math.max(W, H) / s <= 20) ?? 100;
  const ticksX: number[] = [];
  for (let v = 0; v <= W + 0.001; v += step) ticksX.push(v);
  const ticksY: number[] = [];
  for (let v = 0; v <= H + 0.001; v += step) ticksY.push(v);
  let gridPath = "";
  for (let v = 0; v <= W + 0.001; v += SNAP) gridPath += `M${v} 0V${H}`;
  for (let v = 0; v <= H + 0.001; v += SNAP) gridPath += `M0 ${v}H${W}`;

  return (
    <div className="plan-page">
      <div className="plan-head">
        <button type="button" className="secondary" onClick={() => navigate("/plans")}>
          ← Plans
        </button>
        <h1>Modèle : {saved?.name}</h1>
        <span className="muted small">{dirty ? "Modifications non enregistrées" : "Enregistré"}</span>
      </div>

      <div className="plan-toolbar">
        <label>
          Nom du modèle
          <input value={draft.name} onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} />
        </label>
        <label>
          Largeur (mm)
          <input type="number" min="1" value={dims.width} onChange={(e) => setDims({ ...dims, width: e.target.value })} />
        </label>
        <label>
          Profondeur (mm)
          <input type="number" min="1" value={dims.height} onChange={(e) => setDims({ ...dims, height: e.target.value })} />
        </label>
        <button type="button" className="secondary" onClick={applyDims}>
          Appliquer
        </button>
        <button type="button" disabled={!dirty || busy} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer le modèle"}
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>
      {error && <p className="error small">{error}</p>}

      <div className="plan-screen">
        <aside className="card">
          <h2>Étages</h2>
          {levels.length === 0 && <p className="muted small">Aucun étage : ajoutez-en un.</p>}
          <div className="plan-level-list">
            {levels.map((l, i) => (
              <button
                key={i}
                type="button"
                className={`plan-level${i === Math.min(active, levels.length - 1) ? " plan-level-on" : ""}`}
                onClick={() => {
                  setActive(i);
                  setSelected(null);
                }}
              >
                <span>{l.name ?? `Étage ${i + 1}`}</span>
                <span className="muted small">{l.cells.length} case(s)</span>
              </button>
            ))}
          </div>
          {level && (
            <>
              <label>
                Nom de l'étage affiché
                <input
                  value={level.name ?? ""}
                  onChange={(e) =>
                    edit((d) => ({
                      ...d,
                      levels: d.levels.map((l, i) => (i === Math.min(active, levels.length - 1) ? { ...l, name: e.target.value } : l)),
                    }))
                  }
                />
              </label>
              <button type="button" className="secondary danger" onClick={removeLevel}>
                Retirer l'étage affiché
              </button>
            </>
          )}
          <div className="plan-add">
            <input placeholder="Nom du nouvel étage (ex. Haut, Bas)" value={newLevel} onChange={(e) => setNewLevel(e.target.value)} />
            <button type="button" onClick={addLevel}>
              + Ajouter un étage
            </button>
          </div>
        </aside>

        <section className="card plan-main">
          <p className="muted small">Glissez sur une zone vide pour tracer une case · glissez une case pour la déplacer · grille de 5 mm</p>
          {level ? (
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
                const isSel = selected === i;
                const p = moving && moving.index === i ? moving : c;
                const stroke = moving && moving.index === i && !moving.valid ? "#ef4444" : "#3b82f6";
                return (
                  <g key={i} data-cell={i} className={`plan-cell${isSel ? " plan-selected" : ""}`} style={{ cursor: "move" }}>
                    <rect
                      x={p.x}
                      y={p.y}
                      width={p.w}
                      height={p.h}
                      style={{ fill: "#3b82f6", fillOpacity: isSel ? 0.45 : 0.22, stroke, strokeWidth: unit * (isSel ? 2 : 1) }}
                    />
                    <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">
                      {c.name ?? `Case ${i + 1}`}
                    </text>
                    <text x={p.x + p.w / 2} y={p.y + p.h - unit * 2} fontSize={fontSize * 0.7} textAnchor="middle" opacity={0.7}>
                      {p.w} × {p.h}
                    </text>
                  </g>
                );
              })}
              {drawing && (
                <rect className="plan-draft" x={drawing.x} y={drawing.y} width={drawing.w} height={drawing.h} style={{ strokeWidth: unit }} />
              )}
            </svg>
          ) : (
            <div className="plan-empty">
              <p>
                <strong>Modèle vide.</strong>
              </p>
              <ol>
                <li>Ajoutez un étage à gauche (ex. « Haut », « Bas »).</li>
                <li>Glissez sur le plan pour tracer une case.</li>
                <li>Enregistrez : le modèle sera proposé aux contenants sans plan.</li>
              </ol>
            </div>
          )}
          {level && (
            <p className="muted small">
              {W} × {H} mm · étage « {level.name ?? "sans nom"} »
            </p>
          )}
        </section>

        <aside className="card plan-side">
          {selectedCell && selected !== null ? (
            <>
              <h2>Case</h2>
              <label>
                Nom
                <input value={cellForm.name} onChange={(e) => setCellForm({ ...cellForm, name: e.target.value })} placeholder={`Case ${selected + 1}`} />
              </label>
              <div className="plan-dims">
                <label>
                  X (mm)
                  <input type="number" value={cellForm.x} onChange={(e) => setCellForm({ ...cellForm, x: e.target.value })} />
                </label>
                <label>
                  Y (mm)
                  <input type="number" value={cellForm.y} onChange={(e) => setCellForm({ ...cellForm, y: e.target.value })} />
                </label>
                <label>
                  Largeur (mm)
                  <input type="number" min={MIN_SIZE} value={cellForm.w} onChange={(e) => setCellForm({ ...cellForm, w: e.target.value })} />
                </label>
                <label>
                  Profondeur (mm)
                  <input type="number" min={MIN_SIZE} value={cellForm.h} onChange={(e) => setCellForm({ ...cellForm, h: e.target.value })} />
                </label>
              </div>
              <div className="row">
                <button type="button" className="secondary" onClick={applyCell}>
                  Appliquer
                </button>
                <button type="button" className="secondary danger" onClick={removeCell}>
                  Supprimer la case
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>Aide</h2>
              <ul className="small">
                <li>Glissez sur une zone vide pour tracer une case.</li>
                <li>Cliquez une case pour la renommer ou la positionner précisément.</li>
                <li>Les modifications ne sont enregistrées qu'avec « Enregistrer le modèle ».</li>
              </ul>
              <button type="button" className="secondary danger" onClick={archive}>
                Supprimer ce modèle
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
