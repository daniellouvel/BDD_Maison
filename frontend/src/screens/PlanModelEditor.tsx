import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import GridForm from "../components/GridForm";
import PlanCanvas, { type CanvasRect } from "../components/PlanCanvas";
import { MIN_SIZE } from "../components/planGeometry";
import type { PlanCell, PlanModel } from "../types";

/**
 * Éditeur d'un modèle de plan (écran Plans). Même tracé que le plan d'un contenant, mais les
 * modifications restent en brouillon jusqu'à « Enregistrer » : un modèle ne crée rien dans la base
 * tant qu'il n'est pas affecté à un contenant.
 */

const BASE_NAME = "Dans le contenant";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const W = draft?.width_mm ?? 300;
  const H = draft?.height_mm ?? 200;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  // Étages affichés : le bloc sans étage en premier (toujours présent), puis les étages.
  const levels = draft?.levels ?? [];
  const baseIndex = levels.findIndex((l) => l.base);
  const named = levels.flatMap((l, index) =>
    l.base ? [] : [{ key: `l${index}`, index, name: l.name ?? `Étage ${index + 1}`, cells: l.cells, base: false }],
  );
  const shown: { key: string; index: number; name: string; cells: PlanCell[]; base: boolean }[] = [
    { key: "base", index: baseIndex, name: BASE_NAME, cells: baseIndex >= 0 ? levels[baseIndex].cells : [], base: true },
    ...named,
  ];
  const current = shown[Math.min(active, shown.length - 1)];
  const cells = current.cells;
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

  /** Modifie le brouillon ; le modèle n'est enregistré qu'avec le bouton. */
  function edit(fn: (model: PlanModel) => PlanModel) {
    setDraft((d) => (d ? fn(d) : d));
    setMessage(null);
  }

  /** Remplace les cases de l'étage affiché (le bloc sans étage est créé au besoin). */
  function setCells(fn: (list: PlanCell[]) => PlanCell[]) {
    edit((d) => {
      const list = d.levels;
      if (current.base && current.index < 0) {
        return { ...d, levels: [{ name: null, cells: fn([]), base: true }, ...list] };
      }
      return { ...d, levels: list.map((l, i) => (i === current.index ? { ...l, cells: fn(l.cells) } : l)) };
    });
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
          base: Boolean(l.base),
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
    const tooBig = levels.some((l) => l.cells.some((c) => c.x + c.w > width || c.y + c.h > height));
    if (tooBig) return setError("Une case dépasse les nouvelles dimensions : déplacez-la ou réduisez-la d'abord.");
    setError(null);
    edit((d) => ({ ...d, width_mm: width, height_mm: height }));
  }

  /** Vérifie une position dans le modèle : dans le plan, sans chevauchement avec les autres cases. */
  function checkRect(rect: CanvasRect, index: number | null): string | null {
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > W || rect.y + rect.h > H) return "La case sort du plan.";
    const clash = cells.some(
      (c, i) => i !== index && rect.x < c.x + c.w && c.x < rect.x + rect.w && rect.y < c.y + c.h && c.y < rect.y + rect.h,
    );
    return clash ? "Cette case chevauche une autre case." : null;
  }

  function applyCell() {
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
    setError(null);
    const index = selected;
    setCells((list) => list.map((c, i) => (i === index ? { ...c, name: cellForm.name.trim() || null, x, y, w, h } : c)));
  }

  function removeCell() {
    if (selected === null) return;
    const index = selected;
    setCells((list) => list.filter((_, i) => i !== index));
    setSelected(null);
  }

  function addLevel() {
    edit((d) => ({ ...d, levels: [...d.levels, { name: newLevel.trim() || `Étage ${d.levels.length + 1}`, cells: [] }] }));
    setActive(shown.length);
    setNewLevel("");
  }

  function removeLevel() {
    if (current.base || cells.length > 0) return setError("Retirez d'abord les cases de cet étage.");
    const index = current.index;
    edit((d) => ({ ...d, levels: d.levels.filter((_, i) => i !== index) }));
    setActive(0);
  }

  if (loadError) return <p className="error">{loadError}</p>;
  if (!draft) return <p className="muted">Chargement…</p>;

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
          <div className="plan-level-list">
            {shown.map((l, i) => (
              <button
                key={l.key}
                type="button"
                className={`plan-level${i === Math.min(active, shown.length - 1) ? " plan-level-on" : ""}`}
                onClick={() => {
                  setActive(i);
                  setSelected(null);
                }}
              >
                <span>{l.name}</span>
                <span className="muted small">{l.cells.length} case(s)</span>
              </button>
            ))}
          </div>
          {!current.base && (
            <>
              <label>
                Nom de l'étage affiché
                <input
                  value={levels[current.index]?.name ?? ""}
                  onChange={(e) =>
                    edit((d) => ({ ...d, levels: d.levels.map((l, i) => (i === current.index ? { ...l, name: e.target.value } : l)) }))
                  }
                />
              </label>
              {cells.length === 0 && (
                <button type="button" className="secondary danger" onClick={removeLevel}>
                  Retirer l'étage affiché
                </button>
              )}
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
          <GridForm
            W={W}
            H={H}
            existing={cells.length}
            onGenerate={(rects) => {
              setCells(() => rects.map((r) => ({ name: null, ...r })));
              setSelected(null);
            }}
          />
          <PlanCanvas<PlanCell>
            W={W}
            H={H}
            cells={cells}
            selected={selected}
            label={(i) => cells[i].name ?? `Case ${i + 1}`}
            color={() => "#3b82f6"}
            onSelect={setSelected}
            onChange={(next) => setCells(() => next)}
            onDraw={(rect) => {
              const index = cells.length;
              setCells((list) => [...list, { name: null, ...rect }]);
              setSelected(index);
            }}
            onError={setError}
          />
          <p className="muted small">
            {W} × {H} mm · {current.name}
            {cells.length === 0 && " · vide : générez une grille ci-dessus, ou tracez une case, ou ajoutez un étage"}
          </p>
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
                <li>Glissez dans une zone vide, ou depuis le bord d'une case, pour tracer une case.</li>
                <li>Glissez l'intérieur d'une case pour la déplacer, ses poignées pour la redimensionner.</li>
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
