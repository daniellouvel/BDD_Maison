import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import type { BoxCell, BoxLayout, Node, NodeDetail } from "../types";

type Rect = { x: number; y: number; w: number; h: number };

const SNAP = 5; // millimètres
const MIN_SIZE = 10; // millimètres
const DEFAULT: BoxLayout = { width_mm: 300, height_mm: 200, levels: [] };
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

/** Plan d'une boîte à l'échelle (mm), un plan par étage. Chaque case est un élément enfant de son étage. */
export default function BoxPlan({
  node,
  contents,
  canWrite,
  onChanged,
}: {
  node: NodeDetail;
  contents: Node[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  // Un plan enregistré avec l'ancien format (sur photo) n'a pas d'étages : on repart d'un plan vide.
  const stored = node.layout;
  const layout: BoxLayout =
    stored && Array.isArray(stored.levels)
      ? { width_mm: stored.width_mm ?? DEFAULT.width_mm, height_mm: stored.height_mm ?? DEFAULT.height_mm, levels: stored.levels }
      : DEFAULT;
  const { width_mm: W, height_mm: H, levels } = layout;

  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dims, setDims] = useState({ width: String(W), height: String(H) });
  // Case tracée en attente : on choisit le contenant qui la occupe.
  const [newLevel, setNewLevel] = useState("");
  const [pending, setPending] = useState<Rect | null>(null);
  const [choice, setChoice] = useState("new");
  const [newName, setNewName] = useState("");
  const surface = useRef<SVGSVGElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const level = levels[Math.min(active, levels.length - 1)] ?? null;
  const levelName = (id: string | null) => (id === null ? "Dans la boîte" : (contents.find((c) => c.id === id)?.name ?? "Étage"));

  // Noms des cases : ce sont les enfants de chaque étage.
  const key = JSON.stringify(levels);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: Record<string, string> = {};
      for (const l of levels) {
        const kids = await api.get<Node[]>(`/nodes?parent_id=${l.node_id}`).catch(() => [] as Node[]);
        for (const k of kids) if (k.name) found[k.id] = k.name;
      }
      if (!cancelled) setNames(found);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function save(next: BoxLayout) {
    await api.put(`/nodes/${node.id}/layout`, {
      version: node.version,
      width_mm: next.width_mm,
      height_mm: next.height_mm,
      levels: next.levels.map((l) => ({
        node_id: l.node_id,
        cells: l.cells.map((c) => ({ node_id: c.node_id, x: c.x, y: c.y, w: c.w, h: c.h })),
      })),
    });
    onChanged();
  }

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : message);
    } finally {
      setBusy(false);
    }
  }

  function withLevels(next: BoxLevelList): BoxLayout {
    return { ...layout, levels: next };
  }

  async function addLevel() {
    if (!newLevel.trim()) {
      setError("Donnez un nom à l'étage.");
      return;
    }
    const name = newLevel.trim();
    await run(async () => {
      const child = await api.post<NodeDetail>("/nodes", { kind: "container", name, parent_id: node.id });
      await save(withLevels([...levels, { node_id: child.id, cells: [] }]));
      setActive(levels.length);
      setNewLevel("");
    }, "Ajout de l'étage impossible.");
  }

  async function removeLevel() {
    if (!level) return;
    if (level.cells.length > 0) {
      setError("Retirez d'abord les cases de cet étage.");
      return;
    }
    if (!window.confirm(`Retirer l'étage « ${levelName(level.node_id)} » ?`)) return;
    await run(async () => {
      await save(withLevels(levels.filter((l) => l.node_id !== level.node_id)));
      setActive(0);
      await api.del(`/nodes/${level.node_id}`);
    }, "Suppression de l'étage impossible.");
  }

  // Contenants de la boîte qui ne sont ni un étage ni déjà une case : on peut les placer sur le plan.
  const usedIds = levels.flatMap((l) => l.cells.map((c) => c.node_id));
  const free = contents.filter(
    (c) => c.kind === "container" && !levels.some((l) => l.node_id === c.id) && !usedIds.includes(c.id),
  );

  async function confirmCell() {
    if (!level || !pending) return;
    if (choice === "new" && !newName.trim()) {
      setError("Donnez un nom au nouveau contenant.");
      return;
    }
    const rect = pending;
    await run(async () => {
      let nodeId: string;
      if (choice === "new") {
        const child = await api.post<NodeDetail>("/nodes", {
          kind: "container",
          name: newName.trim(),
          parent_id: level.node_id,
        });
        nodeId = child.id;
      } else {
        // Contenant existant : on le range dans l'étage affiché (son contenu le suit).
        const existing = contents.find((c) => c.id === choice);
        if (!existing) throw new ApiError(404, "not_found", "Contenant introuvable.");
        await api.patch(`/nodes/${existing.id}`, { version: existing.version, parent_id: level.node_id });
        nodeId = existing.id;
      }
      const cell: BoxCell = { node_id: nodeId, ...rect };
      await save(withLevels(levels.map((l) => (l.node_id === level.node_id ? { ...l, cells: [...l.cells, cell] } : l))));
      setPending(null);
    }, "Ajout de la case impossible.");
  }

  async function removeCell(cell: BoxCell) {
    if (!level) return;
    if (!window.confirm(`Retirer la case « ${names[cell.node_id] ?? "Case"} » ?`)) return;
    await run(async () => {
      await save(
        withLevels(
          levels.map((l) =>
            l.node_id === level.node_id ? { ...l, cells: l.cells.filter((c) => c.node_id !== cell.node_id) } : l,
          ),
        ),
      );
      try {
        await api.del(`/nodes/${cell.node_id}`);
      } catch (e) {
        // Une case qui contient encore des objets reste dans l'étage, mais n'est plus sur le plan.
        setError(e instanceof ApiError ? `Case retirée du plan, non archivée : ${e.message}` : "Case non archivée.");
      }
    }, "Suppression impossible.");
  }

  async function saveDims() {
    const width = Number(dims.width);
    const height = Number(dims.height);
    if (!(width > 0 && height > 0)) {
      setError("Dimensions invalides.");
      return;
    }
    await run(() => save({ ...layout, width_mm: width, height_mm: height }), "Enregistrement impossible.");
  }

  /**
   * Point sous le curseur, en mm. Il s'accroche aux bords des murs et des cases de l'étage affiché
   * (à 10 px près), sinon à la grille de 5 mm.
   */
  function toMm(e: PointerEvent<SVGSVGElement>) {
    const r = surface.current!.getBoundingClientRect();
    const rawX = clamp(((e.clientX - r.left) / r.width) * W, W);
    const rawY = clamp(((e.clientY - r.top) / r.height) * H, H);
    const tolerance = (W / r.width) * 10;
    const toleranceY = (H / r.height) * 10;
    const xs = [0, W];
    const ys = [0, H];
    for (const c of level?.cells ?? []) {
      xs.push(c.x, c.x + c.w);
      ys.push(c.y, c.y + c.h);
    }
    return { x: attach(rawX, xs, tolerance), y: attach(rawY, ys, toleranceY) };
  }

  function attach(v: number, candidates: number[], tolerance: number) {
    let best = candidates[0];
    for (const c of candidates) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
    return Math.abs(best - v) <= tolerance ? best : snap(v);
  }

  function onDown(e: PointerEvent<SVGSVGElement>) {
    if (!editing || busy || !level) return;
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
    if (!rect) return;
    // Les bords sont déjà calés (accrochage ou grille) : on garde les valeurs, arrondies au dixième.
    const keep = (v: number) => Math.round(v * 10) / 10;
    const r: Rect = { x: keep(rect.x), y: keep(rect.y), w: keep(rect.w), h: keep(rect.h) };
    if (r.w >= MIN_SIZE && r.h >= MIN_SIZE) {
      setPending(r);
      setChoice("new");
      setNewName("");
      setError(null);
    }
  }

  // Traits et textes proportionnels à la taille du plan : sinon, sur une maison, ils deviennent invisibles.
  const unit = Math.max(W, H) / 250;
  const fontSize = unit * 4;

  return (
    <section className="card">
      <h2>Plan</h2>

      {levels.length > 0 && (
        <div className="tabs">
          {levels.map((l, i) => (
            <button
              key={l.node_id}
              type="button"
              className={i === active ? "" : "secondary"}
              onClick={() => setActive(i)}
            >
              {levelName(l.node_id)}
            </button>
          ))}
        </div>
      )}

      {level ? (
        <svg
          ref={surface}
          className={`plan${editing ? " plan-editing" : ""}`}
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <defs>
            <pattern id={`grid-${node.id}`} width={SNAP * 2} height={SNAP * 2} patternUnits="userSpaceOnUse">
              <path d={`M ${SNAP * 2} 0 L 0 0 0 ${SNAP * 2}`} fill="none" stroke="#888" strokeOpacity="0.3" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill={editing ? `url(#grid-${node.id})` : "none"} stroke="#888" strokeWidth={unit * 1.5} />
          {level.cells.map((c) => (
            <g
              key={c.node_id}
              className="plan-cell"
              onClick={() => !editing && navigate(`/nodes/${c.node_id}`)}
            >
              <rect x={c.x} y={c.y} width={c.w} height={c.h} style={{ strokeWidth: unit }} />
              <text x={c.x + c.w / 2} y={c.y + c.h / 2} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">
                {names[c.node_id] ?? "Case"}
              </text>
            </g>
          ))}
          {draft && <rect className="plan-draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h} style={{ strokeWidth: unit }} />}
        </svg>
      ) : (
        <p className="muted">
          Aucun étage. {canWrite ? "Ajoutez un étage ci-dessous, puis tracez ses compartiments." : ""}
        </p>
      )}

      {level && (
        <p className="muted small">
          {W} × {H} mm{editing ? " · glissez sur le plan pour tracer une case (pas de 5 mm)" : " · touchez une case pour l'ouvrir"}
        </p>
      )}

      {canWrite && (
        <div className="row">
          <input
            placeholder="Nom de l'étage (ex. Étage 1, Haut, Bas)"
            value={newLevel}
            onChange={(e) => setNewLevel(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={addLevel}>
            + Ajouter un étage
          </button>
        </div>
      )}
      {canWrite && (
        <div className="row">
          <button type="button" className="secondary" onClick={() => setEditing(!editing)}>
            {editing ? "Terminer le tracé" : "Modifier le plan"}
          </button>
        </div>
      )}

      {editing && canWrite && (
        <>
          <div className="row">
            <label>
              Largeur (mm)
              <input type="number" min="1" value={dims.width} onChange={(e) => setDims({ ...dims, width: e.target.value })} />
            </label>
            <label>
              Profondeur (mm)
              <input type="number" min="1" value={dims.height} onChange={(e) => setDims({ ...dims, height: e.target.value })} />
            </label>
            <button type="button" className="secondary" disabled={busy} onClick={saveDims}>
              Enregistrer les dimensions
            </button>
          </div>
          <div className="row">
            {level && (
              <button type="button" className="secondary danger" disabled={busy} onClick={removeLevel}>
                Retirer l'étage affiché
              </button>
            )}
          </div>
          {level && level.cells.length > 0 && (
            <ul className="list">
              {level.cells.map((c) => (
                <li key={c.node_id}>
                  {names[c.node_id] ?? "Case"} · {c.w} × {c.h} mm{" "}
                  <button type="button" className="linklike danger" disabled={busy} onClick={() => removeCell(c)}>
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {pending && level && (
        <div className="form">
          <p>Quel contenant occupe cette case ({Math.round(pending.w)} × {Math.round(pending.h)} mm) ?</p>
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
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}

type BoxLevelList = BoxLayout["levels"];
