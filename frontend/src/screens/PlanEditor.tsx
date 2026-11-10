import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import PlanCanvas, { type CanvasRect } from "../components/PlanCanvas";
import { MIN_SIZE, round1 } from "../components/planGeometry";
import type { BoxCell, BoxLayout, Node, NodeDetail, NodeType, PlanModel } from "../types";

/**
 * Éditeur du plan d'une boîte (PC). Colonnes : étages à gauche, plan au centre, inspecteur à droite.
 * Le bloc « Dans la boîte » reçoit les cases qui ne sont dans aucun étage ; les étages sont optionnels.
 * Chaque modification est enregistrée tout de suite.
 */

const PALETTE = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#ec4899"];
const NO_TYPE = "#94a3b8";

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
  const [models, setModels] = useState<PlanModel[]>([]);
  const [chosenModel, setChosenModel] = useState("");

  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<CanvasRect | null>(null);
  const [choice, setChoice] = useState("new");
  const [newName, setNewName] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const [dims, setDims] = useState({ width: "", height: "" });
  const [cellForm, setCellForm] = useState({ x: "", y: "", w: "", h: "", name: "" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<NodeDetail>(`/nodes/${id}`);
      const children = await api.get<Node[]>(`/nodes?parent_id=${data.id}`);
      const plan = normalize(data.layout);
      const found: Record<string, Node> = {};
      for (const k of children) found[k.id] = k;
      for (const l of plan.levels) {
        if (l.node_id === null) continue;
        const cells = await api.get<Node[]>(`/nodes?parent_id=${l.node_id}`).catch(() => [] as Node[]);
        for (const k of cells) found[k.id] = k;
      }
      // Les cases du bloc sans étage sont directement dans la boîte, déjà chargées avec ses enfants.
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

  // Modèles proposés pour une boîte sans plan.
  useEffect(() => {
    if (!canWrite) return;
    api.get<PlanModel[]>("/plans").then(setModels).catch(() => setModels([]));
  }, [canWrite]);

  // Champs de dimensions suivent le plan enregistré.
  useEffect(() => {
    setDims({ width: String(layout.width_mm), height: String(layout.height_mm) });
  }, [layout.width_mm, layout.height_mm]);

  const W = layout.width_mm;
  const H = layout.height_mm;

  // Étages affichés : le bloc « Dans la boîte » (sans étage) en premier, puis les étages.
  const baseCells = layout.levels.find((l) => l.node_id === null)?.cells ?? [];
  const shown: { node_id: string | null; name: string; cells: BoxCell[] }[] = [
    { node_id: null, name: "Dans la boîte", cells: baseCells },
    ...layout.levels
      .filter((l) => l.node_id !== null)
      .map((l) => ({ node_id: l.node_id, name: nodes[l.node_id as string]?.name ?? "Étage", cells: l.cells })),
  ];
  const level = shown[Math.min(active, shown.length - 1)];
  const cells = level.cells;

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
  const selectedCell = selected !== null ? cells[selected] ?? null : null;

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

  /** Remplace les cases de l'étage `levelId` (null = bloc sans étage, créé au besoin). */
  function withCells(levelId: string | null, fn: (list: BoxCell[]) => BoxCell[]): BoxLayout {
    const hasBase = layout.levels.some((l) => l.node_id === null);
    const base = levelId === null && !hasBase ? [{ node_id: null, cells: [] }, ...layout.levels] : layout.levels;
    return { ...layout, levels: base.map((l) => (l.node_id === levelId ? { ...l, cells: fn(l.cells) } : l)) };
  }

  async function addLevel() {
    const name = newLevel.trim();
    if (!name || !box) return setError("Donnez un nom à l'étage.");
    await run(async () => {
      const child = await api.post<NodeDetail>("/nodes", { kind: "container", name, parent_id: box.id });
      await save({ ...layout, levels: [...layout.levels, { node_id: child.id, cells: [] }] });
      setActive(shown.length);
      setNewLevel("");
    }, "Ajout de l'étage impossible.");
  }

  async function removeLevel() {
    if (!level || level.node_id === null) return;
    const levelId = level.node_id;
    if (cells.length > 0) return setError("Retirez d'abord les cases de cet étage.");
    if (!window.confirm(`Retirer l'étage « ${level.name} » ?`)) return;
    await run(async () => {
      await save({ ...layout, levels: layout.levels.filter((l) => l.node_id !== levelId) });
      setActive(0);
      await api.del(`/nodes/${levelId}`);
    }, "Suppression de l'étage impossible.");
  }

  // Contenants de la boîte qui ne sont ni un étage ni déjà une case : on peut les placer sur le plan.
  async function confirmCell() {
    if (!pending) return;
    if (choice === "new" && !newName.trim()) return setError("Donnez un nom au nouveau contenant.");
    const rect = pending;
    const levelId = level.node_id;
    const parentId = levelId ?? box?.id;
    if (!parentId) return;
    await run(async () => {
      let nodeId: string;
      if (choice === "new") {
        const child = await api.post<NodeDetail>("/nodes", { kind: "container", name: newName.trim(), parent_id: parentId });
        nodeId = child.id;
      } else {
        // Contenant existant : on le range à l'endroit affiché (son contenu le suit).
        const existing = kids.find((c) => c.id === choice);
        if (!existing) throw new ApiError(404, "not_found", "Contenant introuvable.");
        await api.patch(`/nodes/${existing.id}`, { version: existing.version, parent_id: parentId });
        nodeId = existing.id;
      }
      await save(withCells(levelId, (list) => [...list, { node_id: nodeId, ...rect }]));
      setPending(null);
      setSelected(cells.length);
    }, "Ajout de la case impossible.");
  }

  async function removeCell(index: number) {
    const cell = cells[index];
    if (!cell) return;
    const levelId = level.node_id;
    if (!window.confirm(`Retirer « ${nameOf(cell.node_id)} » du plan ? Le contenant est archivé s'il est vide.`)) return;
    await run(async () => {
      await save(withCells(levelId, (list) => list.filter((_, i) => i !== index)));
      setSelected(null);
      try {
        await api.del(`/nodes/${cell.node_id}`);
      } catch (e) {
        // Une case qui contient encore des objets reste rangée, mais n'est plus sur le plan.
        setError(e instanceof ApiError ? `Case retirée du plan, non archivée : ${e.message}` : "Case non archivée.");
      }
    }, "Suppression impossible.");
  }

  /** Vérifie la position d'une case dans la boîte : dans le plan, sans chevauchement. */
  function checkRect(rect: CanvasRect, index: number | null): string | null {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > W || rect.y + rect.h > H) return "La case sort du plan.";
    const clash = cells.some(
      (c, i) => i !== index && rect.x < c.x + c.w && c.x < rect.x + rect.w && rect.y < c.y + c.h && c.y < rect.y + rect.h,
    );
    return clash ? "Cette case chevauche une autre case." : null;
  }

  async function applyCell() {
    if (selected === null || !selectedCell) return;
    const x = Number(cellForm.x);
    const y = Number(cellForm.y);
    const w = Number(cellForm.w);
    const h = Number(cellForm.h);
    if (![x, y, w, h].every(Number.isFinite) || w < MIN_SIZE || h < MIN_SIZE) {
      return setError(`Dimensions invalides (minimum ${MIN_SIZE} mm).`);
    }
    const problem = checkRect({ x, y, w, h }, selected);
    if (problem) return setError(problem);
    const index = selected;
    const levelId = level.node_id;
    await run(
      () => save(withCells(levelId, (list) => list.map((c, i) => (i === index ? { ...c, x, y, w, h } : c)))),
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

  async function applyModel() {
    if (!box || !chosenModel) return;
    await run(async () => {
      await api.post(`/plans/${chosenModel}/apply`, { node_id: box.id, node_version: box.version });
      setChosenModel("");
      await load();
    }, "Affectation impossible.");
  }

  if (loadError) return <p className="error">{loadError} <button type="button" className="secondary" onClick={() => navigate("/")}>Retour</button></p>;
  if (!box) return <p className="muted">Chargement…</p>;

  const legendTypes = Array.from(new Set(cells.map((c) => nodes[c.node_id]?.node_type_id ?? null)));

  return (
    <div className="plan-page">
      <div className="plan-head">
        <button type="button" className="secondary" onClick={() => navigate("/")}>
          ← Explorateur
        </button>
        <h1>Plan : {box.name ?? box.article_name ?? "Boîte"}</h1>
        <span className="muted small">{box.breadcrumb.map((b) => b.name).join(" › ")}</span>
      </div>

      {layout.levels.length === 0 && canWrite && (
        <section className="card">
          <h2>Affecter un plan</h2>
          {models.length === 0 ? (
            <p className="muted small">
              Aucun modèle. Créez-en un dans <a href="/plans">Plans</a>, puis revenez ici.
            </p>
          ) : (
            <div className="row">
              <select value={chosenModel} onChange={(e) => setChosenModel(e.target.value)}>
                <option value="">— choisir un modèle —</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.width_mm} × {m.height_mm} mm)
                  </option>
                ))}
              </select>
              <button type="button" disabled={!chosenModel || busy} onClick={applyModel}>
                Affecter ce plan
              </button>
            </div>
          )}
          <p className="muted small">Ou tracez directement les cases ci-dessous, et ajoutez des étages quand vous voulez.</p>
        </section>
      )}

      <div className="plan-screen">
        {/* Colonne gauche : bloc sans étage, étages et contenants non placés */}
        <aside className="card">
          <h2>Étages</h2>
          <div className="plan-level-list">
            {shown.map((l, i) => (
              <button
                key={l.node_id ?? "base"}
                type="button"
                className={`plan-level${i === Math.min(active, shown.length - 1) ? " plan-level-on" : ""}`}
                onClick={() => {
                  setActive(i);
                  setSelected(null);
                  setPending(null);
                }}
              >
                <span>{l.name}</span>
                <span className="muted small">{l.cells.length} case(s)</span>
              </button>
            ))}
          </div>
          {canWrite && (
            <div className="plan-add">
              <input placeholder="Nom de l'étage (ex. Haut, Bas)" value={newLevel} onChange={(e) => setNewLevel(e.target.value)} />
              <button type="button" disabled={busy} onClick={addLevel}>
                + Ajouter un étage
              </button>
              {level.node_id !== null && cells.length === 0 && (
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
                ? "Glissez dans une zone vide pour tracer · glissez une case pour la déplacer · poignées pour la redimensionner"
                : "Lecture seule"}
            </span>
          </div>

          <PlanCanvas<BoxCell>
            W={W}
            H={H}
            cells={cells}
            selected={selected}
            readOnly={!canWrite}
            pending={pending}
            label={(i) => nameOf(cells[i].node_id)}
            color={(i) => colorOf(nodes[cells[i].node_id]?.node_type_id ?? null)}
            onSelect={(i) => {
              setSelected(i);
              setPending(null);
            }}
            onChange={(next) => void run(() => save(withCells(level.node_id, () => next)), "Déplacement impossible.")}
            onDraw={(rect) => {
              setPending(rect);
              setChoice("new");
              setNewName("");
              setError(null);
            }}
            onError={setError}
          />

          <p className="muted small">
            {W} × {H} mm · {level.name}
            {cells.length === 0 && " · vide : tracez une case, ou affectez un modèle"}
          </p>
          {legendTypes.length > 0 && (
            <div className="plan-legend">
              {legendTypes.map((t) => (
                <span key={t ?? "none"} className="plan-chip">
                  <i style={{ background: t ? colorOf(t) : NO_TYPE }} /> {typeName(t)}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Droite : inspecteur */}
        <aside className="card plan-side">
          {pending && (
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
                  <button type="button" className="secondary danger" disabled={busy} onClick={() => removeCell(selected as number)}>
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
                <li>Glissez dans une zone vide, ou depuis le bord d'une case, pour tracer une nouvelle case.</li>
                <li>Glissez l'intérieur d'une case pour la déplacer.</li>
                <li>Une case sélectionnée a des poignées : glissez-les pour la redimensionner.</li>
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
