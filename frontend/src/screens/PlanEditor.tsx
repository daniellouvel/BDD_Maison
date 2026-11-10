import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { BoxCell, BoxLayout, Node, NodeDetail, NodeType } from "../types";

/**
 * Éditeur de plan dédié (PC). Trois colonnes : étages et contenants non placés à gauche,
 * plan avec axes au centre, inspecteur de la case à droite. Tracer = glisser sur une zone vide.
 */

type Rect = { x: number; y: number; w: number; h: number };

const SNAP = 5; // millimètres
const MIN_SIZE = 10; // millimètres
const PALETTE = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#ec4899"];
const NO_TYPE = "#94a3b8";
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function normalize(stored: BoxLayout | null | undefined): BoxLayout {
  if (stored && Array.isArray(stored.levels)) {
    return { width_mm: stored.width_mm, height_mm: stored.height_mm, levels: stored.levels };
  }
  return { width_mm: 300, height_mm: 200, levels: [] };
}

export default function PlanEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { canWrite } = useAuth();

  const [box, setBox] = useState<NodeDetail | null>(null);
  const [layout, setLayout] = useState<BoxLayout>(normalize(null));
  const [kids, setKids] = useState<Node[]>([]); // enfants directs de la boîte (étages et contenants)
  const [nodes, setNodes] = useState<Record<string, Node>>({}); // étages, cases et contenants connus
  const [types, setTypes] = useState<NodeType[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [pending, setPending] = useState<Rect | null>(null);
  const [choice, setChoice] = useState("new");
  const [newName, setNewName] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const [dims, setDims] = useState({ width: "", height: "" });
  const [cellForm, setCellForm] = useState({ x: "", y: "", w: "", h: "", name: "" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<NodeDetail>(`/nodes/${id}`);
      const children = await api.get<Node[]>(`/nodes?parent_id=${data.id}`);
      const plan = normalize(data.layout);
      const found: Record<string, Node> = {};
      for (const k of children) found[k.id] = k;
      for (const l of plan.levels) {
        const cells = await api.get<Node[]>(`/nodes?parent_id=${l.node_id}`).catch(() => [] as Node[]);
        for (const k of cells) found[k.id] = k;
      }
      setBox(data);
      setLayout(plan);
      setKids(children);
      setNodes(found);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Plan introuvable.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get<NodeType[]>("/node-types").then(setTypes).catch(() => setTypes([]));
  }, []);

  // Champs de dimensions suivent le plan enregistré.
  useEffect(() => {
    setDims({ width: String(layout.width_mm), height: String(layout.height_mm) });
  }, [layout.width_mm, layout.height_mm]);

  const level = layout.levels[Math.min(active, layout.levels.length - 1)] ?? null;
  const W = layout.width_mm;
  const H = layout.height_mm;
  // Marge pour les axes ; traits et textes proportionnels à la taille du plan.
  const unit = Math.max(W, H) / 250;
  const fontSize = unit * 4;
  const M = unit * 14;

  const nameOf = (nodeId: string) => nodes[nodeId]?.name ?? "Case";
  const typeName = (typeId: string | null | undefined) => types.find((t) => t.id === typeId)?.name ?? "Sans type";
  const colorOf = (typeId: string | null | undefined) => {
    if (!typeId) return NO_TYPE;
    const i = types.findIndex((t) => t.id === typeId);
    return i < 0 ? NO_TYPE : PALETTE[i % PALETTE.length];
  };

  const usedIds = layout.levels.flatMap((l) => l.cells.map((c) => c.node_id));
  const free = kids.filter(
    (c) => c.kind === "container" && !layout.levels.some((l) => l.node_id === c.id) && !usedIds.includes(c.id),
  );
  const selectedCell = level?.cells.find((c) => c.node_id === selected) ?? null;

  // Le formulaire de la case suit la case sélectionnée et les valeurs enregistrées.
  useEffect(() => {
    if (!selectedCell) return;
    setCellForm({
      x: String(selectedCell.x),
      y: String(selectedCell.y),
      w: String(selectedCell.w),
      h: String(selectedCell.h),
      name: nodes[selectedCell.node_id]?.name ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, layout]);

  async function save(next: BoxLayout) {
    if (!box) return;
    await api.put(`/nodes/${box.id}/layout`, {
      version: box.version,
      width_mm: next.width_mm,
      height_mm: next.height_mm,
      levels: next.levels.map((l) => ({
        node_id: l.node_id,
        cells: l.cells.map((c) => ({ node_id: c.node_id, x: c.x, y: c.y, w: c.w, h: c.h })),
      })),
    });
    await load();
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  function withCells(levelId: string, fn: (cells: BoxCell[]) => BoxCell[]): BoxLayout {
    return { ...layout, levels: layout.levels.map((l) => (l.node_id === levelId ? { ...l, cells: fn(l.cells) } : l)) };
  }

  async function addLevel() {
    const name = newLevel.trim();
    if (!name || !box) return setError("Donnez un nom à l'étage.");
    await run(async () => {
      const child = await api.post<NodeDetail>("/nodes", { kind: "container", name, parent_id: box.id });
      await save({ ...layout, levels: [...layout.levels, { node_id: child.id, cells: [] }] });
      setActive(layout.levels.length);
      setNewLevel("");
    }, "Ajout de l'étage impossible.");
  }

  async function removeLevel() {
    if (!level) return;
    const levelId = level.node_id;
    if (level.cells.length > 0) return setError("Retirez d'abord les cases de cet étage.");
    if (!window.confirm(`Retirer l'étage « ${nameOf(levelId)} » ?`)) return;
    await run(async () => {
      await save({ ...layout, levels: layout.levels.filter((l) => l.node_id !== levelId) });
      setActive(0);
      await api.del(`/nodes/${levelId}`);
    }, "Suppression de l'étage impossible.");
  }

  async function confirmCell() {
    if (!level || !pending) return;
    if (choice === "new" && !newName.trim()) return setError("Donnez un nom au nouveau contenant.");
    const rect = pending;
    const levelId = level.node_id;
    await run(async () => {
      let nodeId: string;
      if (choice === "new") {
        const child = await api.post<NodeDetail>("/nodes", { kind: "container", name: newName.trim(), parent_id: levelId });
        nodeId = child.id;
      } else {
        // Contenant existant : on le range dans l'étage affiché (son contenu le suit).
        const existing = kids.find((c) => c.id === choice);
        if (!existing) throw new ApiError(404, "not_found", "Contenant introuvable.");
        await api.patch(`/nodes/${existing.id}`, { version: existing.version, parent_id: levelId });
        nodeId = existing.id;
      }
      await save(withCells(levelId, (cells) => [...cells, { node_id: nodeId, ...rect }]));
      setPending(null);
      setSelected(nodeId);
    }, "Ajout de la case impossible.");
  }

  async function removeCell(cellId: string) {
    if (!level) return;
    const levelId = level.node_id;
    if (!window.confirm(`Retirer « ${nameOf(cellId)} » du plan ? Le contenant est archivé s'il est vide.`)) return;
    await run(async () => {
      await save(withCells(levelId, (cells) => cells.filter((c) => c.node_id !== cellId)));
      setSelected(null);
      try {
        await api.del(`/nodes/${cellId}`);
      } catch (e) {
        // Une case qui contient encore des objets reste rangée, mais n'est plus sur le plan.
        setError(e instanceof ApiError ? `Case retirée du plan, non archivée : ${e.message}` : "Case non archivée.");
      }
    }, "Suppression impossible.");
  }

  async function applyCell() {
    if (!level || !selectedCell) return;
    const levelId = level.node_id;
    const cellId = selectedCell.node_id;
    const x = Number(cellForm.x);
    const y = Number(cellForm.y);
    const w = Number(cellForm.w);
    const h = Number(cellForm.h);
    if (![x, y, w, h].every(Number.isFinite) || w < MIN_SIZE || h < MIN_SIZE) {
      return setError(`Dimensions invalides (minimum ${MIN_SIZE} mm).`);
    }
    await run(
      () => save(withCells(levelId, (cells) => cells.map((c) => (c.node_id === cellId ? { ...c, x, y, w, h } : c)))),
      "Enregistrement impossible.",
    );
  }

  async function renameCell() {
    if (!selectedCell || !cellForm.name.trim()) return;
    const node = nodes[selectedCell.node_id];
    if (!node) return;
    await run(async () => {
      await api.patch(`/nodes/${node.id}`, { version: node.version, name: cellForm.name.trim() });
      await load();
    }, "Renommage impossible.");
  }

  async function applyDims() {
    const width = Number(dims.width);
    const height = Number(dims.height);
    if (!(width > 0 && height > 0)) return setError("Dimensions invalides.");
    await run(() => save({ ...layout, width_mm: width, height_mm: height }), "Enregistrement impossible.");
  }

  /**
   * Point sous le curseur, en mm. Il s'accroche aux bords des murs et des cases de l'étage affiché
   * (à 10 px près), sinon à la grille de 5 mm.
   */
  function toMm(e: PointerEvent<SVGSVGElement>) {
    const r = surface.current!.getBoundingClientRect();
    const sx = (W + 2 * M) / r.width;
    const sy = (H + 2 * M) / r.height;
    const rawX = clamp((e.clientX - r.left) * sx - M, W);
    const rawY = clamp((e.clientY - r.top) * sy - M, H);
    const xs = [0, W];
    const ys = [0, H];
    for (const c of level?.cells ?? []) {
      xs.push(c.x, c.x + c.w);
      ys.push(c.y, c.y + c.h);
    }
    return { x: attach(rawX, xs, sx * 10), y: attach(rawY, ys, sy * 10) };
  }

  function attach(v: number, candidates: number[], tolerance: number) {
    let best = candidates[0];
    for (const c of candidates) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
    return Math.abs(best - v) <= tolerance ? best : snap(v);
  }

  function onDown(e: PointerEvent<SVGSVGElement>) {
    const cell = (e.target as Element).closest?.("[data-cell]");
    if (cell) {
      setSelected(cell.getAttribute("data-cell"));
      return;
    }
    setSelected(null);
    if (!canWrite || busy || !level) return;
    origin.current = toMm(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ x: origin.current.x, y: origin.current.y, w: 0, h: 0 });
  }

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const o = origin.current;
    if (!o) return;
    const p = toMm(e);
    setDraft({ x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) });
  }

  function onUp() {
    const rect = draft;
    origin.current = null;
    setDraft(null);
    if (!rect || !level) return;
    const r: Rect = { x: round1(rect.x), y: round1(rect.y), w: round1(rect.w), h: round1(rect.h) };
    if (r.w < MIN_SIZE || r.h < MIN_SIZE) return;
    const overlaps = level.cells.some(
      (c) => r.x < c.x + c.w && c.x < r.x + r.w && r.y < c.y + c.h && c.y < r.y + r.h,
    );
    if (overlaps) return setError("Cette zone chevauche une case existante.");
    setPending(r);
    setChoice("new");
    setNewName("");
    setError(null);
  }

  if (loadError) return <p className="error">{loadError} <button type="button" className="secondary" onClick={() => navigate("/")}>Retour</button></p>;
  if (!box) return <p className="muted">Chargement…</p>;

  // Graduation : pas de 10 à 100 mm selon la taille de la boîte.
  const step = [10, 20, 50, 100].find((s) => Math.max(W, H) / s <= 20) ?? 100;
  const ticksX: number[] = [];
  for (let v = 0; v <= W + 0.001; v += step) ticksX.push(v);
  const ticksY: number[] = [];
  for (let v = 0; v <= H + 0.001; v += step) ticksY.push(v);
  let gridPath = "";
  for (let v = 0; v <= W + 0.001; v += SNAP) gridPath += `M${v} 0V${H}`;
  for (let v = 0; v <= H + 0.001; v += SNAP) gridPath += `M0 ${v}H${W}`;

  const legendTypes = Array.from(new Set(level?.cells.map((c) => nodes[c.node_id]?.node_type_id ?? null) ?? []));

  return (
    <div className="plan-page">
      <div className="plan-head">
        <button type="button" className="secondary" onClick={() => navigate("/")}>
          ← Explorateur
        </button>
        <h1>Plan : {box.name ?? box.article_name ?? "Boîte"}</h1>
        <span className="muted small">{box.breadcrumb.map((b) => b.name).join(" › ")}</span>
      </div>

      <div className="plan-screen">
        {/* Colonne gauche : étages et contenants non placés */}
        <aside className="card">
          <h2>Étages</h2>
          {layout.levels.length === 0 && <p className="muted small">Aucun étage pour l'instant.</p>}
          <div className="plan-level-list">
            {layout.levels.map((l, i) => (
              <button
                key={l.node_id}
                type="button"
                className={`plan-level${i === active ? " plan-level-on" : ""}`}
                onClick={() => {
                  setActive(i);
                  setSelected(null);
                  setPending(null);
                }}
              >
                <span>{nodes[l.node_id]?.name ?? "Étage"}</span>
                <span className="muted small">{l.cells.length} case(s)</span>
              </button>
            ))}
          </div>
          {canWrite && (
            <div className="plan-add">
              <input
                placeholder="Nom de l'étage (ex. Haut, Bas)"
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value)}
              />
              <button type="button" disabled={busy} onClick={addLevel}>
                + Ajouter un étage
              </button>
              {level && level.cells.length === 0 && (
                <button type="button" className="secondary danger" disabled={busy} onClick={removeLevel}>
                  Retirer l'étage affiché
                </button>
              )}
            </div>
          )}

          <h3>Non placés</h3>
          {free.length === 0 && <p className="muted small">Aucun contenant en attente.</p>}
          <ul className="list">
            {free.map((c) => (
              <li key={c.id}>
                <button type="button" className="linklike" onClick={() => navigate(`/?n=${c.id}`)}>
                  {c.name ?? "Sans nom"}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Centre : le plan */}
        <section className="card plan-main">
          <div className="plan-toolbar">
            {canWrite && (
              <>
                <label>
                  Largeur (mm)
                  <input type="number" min="1" value={dims.width} onChange={(e) => setDims({ ...dims, width: e.target.value })} />
                </label>
                <label>
                  Profondeur (mm)
                  <input type="number" min="1" value={dims.height} onChange={(e) => setDims({ ...dims, height: e.target.value })} />
                </label>
                <button type="button" className="secondary" disabled={busy} onClick={applyDims}>
                  Appliquer
                </button>
              </>
            )}
            <span className="muted small">
              {canWrite
                ? "Glissez sur une zone vide pour tracer une case · touchez une case pour la sélectionner · grille de 5 mm"
                : "Lecture seule"}
            </span>
          </div>

          {level ? (
            <svg
              ref={surface}
              className="plan-svg"
              viewBox={`${-M} ${-M} ${W + 2 * M} ${H + 2 * M}`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {/* Grille fine et axes numérotés en mm */}
              {canWrite && <path d={gridPath} fill="none" stroke="#888" strokeOpacity="0.2" strokeWidth={unit * 0.4} />}
              <path
                d={[
                  ...ticksX.map((v) => `M${v} 0V${-unit * 1.5}`),
                  ...ticksY.map((v) => `M0 ${v}H${-unit * 1.5}`),
                ].join("")}
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

              {level.cells.map((c) => {
                const isSel = selected === c.node_id;
                const color = colorOf(nodes[c.node_id]?.node_type_id ?? null);
                return (
                  <g key={c.node_id} data-cell={c.node_id} className={`plan-cell${isSel ? " plan-selected" : ""}`}>
                    <rect
                      x={c.x}
                      y={c.y}
                      width={c.w}
                      height={c.h}
                      style={{ fill: color, fillOpacity: isSel ? 0.45 : 0.22, stroke: color, strokeWidth: unit * (isSel ? 2 : 1) }}
                    />
                    <text x={c.x + c.w / 2} y={c.y + c.h / 2} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">
                      {nameOf(c.node_id)}
                    </text>
                    <text x={c.x + c.w / 2} y={c.y + c.h - unit * 2} fontSize={fontSize * 0.7} textAnchor="middle" opacity={0.7}>
                      {c.w} × {c.h}
                    </text>
                  </g>
                );
              })}

              {pending && (
                <rect className="plan-draft" x={pending.x} y={pending.y} width={pending.w} height={pending.h} style={{ strokeWidth: unit }} />
              )}
              {draft && (
                <rect className="plan-draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h} style={{ strokeWidth: unit }} />
              )}
            </svg>
          ) : (
            <div className="plan-empty">
              <p>
                <strong>Plan vide.</strong>
              </p>
              <ol>
                <li>Ajoutez un étage à gauche (ex. « Haut », « Bas »).</li>
                <li>Glissez sur le plan pour tracer une case.</li>
                <li>Choisissez le contenant qui occupe la case : nouveau, ou déjà existant.</li>
              </ol>
            </div>
          )}

          {level && (
            <p className="muted small">
              {W} × {H} mm · étage « {nameOf(level.node_id)} »
            </p>
          )}
          {legendTypes.length > 0 && (
            <div className="plan-legend">
              {legendTypes.map((t) => (
                <span key={t ?? "none"} className="plan-chip">
                  <i style={{ background: colorOf(t) }} /> {typeName(t)}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Droite : inspecteur */}
        <aside className="card plan-side">
          {pending && level && (
            <>
              <h2>Nouvelle case</h2>
              <p className="small">
                Quel contenant occupe cette zone ({round1(pending.w)} × {round1(pending.h)} mm) ?
              </p>
              <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="new">+ Nouveau contenant</option>
                {free.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? "Sans nom"}
                  </option>
                ))}
              </select>
              {choice === "new" && (
                <input placeholder="Nom (ex. A1, Vis M3…)" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              )}
              <div className="row">
                <button type="button" disabled={busy} onClick={confirmCell}>
                  Ajouter la case
                </button>
                <button type="button" className="secondary" onClick={() => setPending(null)}>
                  Annuler
                </button>
              </div>
            </>
          )}

          {!pending && selectedCell && (
            <>
              <h2>Case</h2>
              <p className="muted small">Type : {typeName(nodes[selectedCell.node_id]?.node_type_id)}</p>
              {canWrite && (
                <>
                  <label>
                    Nom
                    <input value={cellForm.name} onChange={(e) => setCellForm({ ...cellForm, name: e.target.value })} />
                  </label>
                  <button type="button" className="secondary" disabled={busy} onClick={renameCell}>
                    Renommer
                  </button>
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
                  <button type="button" className="secondary" disabled={busy} onClick={applyCell}>
                    Appliquer position et taille
                  </button>
                </>
              )}
              <div className="row">
                <button type="button" onClick={() => navigate(`/?n=${selectedCell.node_id}`)}>
                  Ouvrir le contenant
                </button>
                {canWrite && (
                  <button type="button" className="secondary danger" disabled={busy} onClick={() => removeCell(selectedCell.node_id)}>
                    Retirer du plan
                  </button>
                )}
              </div>
            </>
          )}

          {!pending && !selectedCell && (
            <>
              <h2>Aide</h2>
              <ul className="small">
                <li>Cliquez une case pour la voir, la renommer ou la déplacer précisément.</li>
                <li>Glissez sur une zone vide pour tracer une nouvelle case (pas de 5 mm, accroche les bords).</li>
                <li>Les cases ne peuvent pas se chevaucher.</li>
              </ul>
            </>
          )}

          {error && <p className="error small">{error}</p>}
        </aside>
      </div>
    </div>
  );
}
