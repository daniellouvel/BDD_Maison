import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { PlanCell, PlanLevel, PlanModel } from "../types";

type PresetLevel = { name: string | null; base: boolean; cells: PlanCell[] };
type Preset = { label: string; name: string; width: number; height: number; levels: PresetLevel[] };

/** Grille de tiroirs ou de compartiments, à partir d'une taille de case (type Gridfinity). */
function grid(rows: number, cols: number, size: number): Preset {
  const cells: PlanCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ name: `${String.fromCharCode(65 + r)}${c + 1}`, x: c * size, y: r * size, w: size, h: size });
    }
  }
  return {
    label: `Grille ${rows} × ${cols} (cases de ${size} mm)`,
    name: `Grille ${rows} × ${cols}`,
    width: cols * size,
    height: rows * size,
    levels: [{ name: null, base: true, cells }],
  };
}

/** Préréglages prêts à l'emploi : on les crée comme un modèle, puis on les modifie au besoin. */
const PRESETS: Preset[] = [
  grid(4, 6, 40),
  grid(3, 4, 60),
  {
    label: "Tiroir à 3 compartiments (300 × 200 mm)",
    name: "Tiroir 3 compartiments",
    width: 300,
    height: 200,
    levels: [
      {
        name: null,
        base: true,
        cells: [
          { name: "Compartiment 1", x: 0, y: 0, w: 100, h: 200 },
          { name: "Compartiment 2", x: 100, y: 0, w: 100, h: 200 },
          { name: "Compartiment 3", x: 200, y: 0, w: 100, h: 200 },
        ],
      },
    ],
  },
  {
    label: "Servante à 4 tiroirs (300 × 400 mm)",
    name: "Servante 4 tiroirs",
    width: 300,
    height: 400,
    levels: [1, 2, 3, 4].map((n) => ({
      name: `Tiroir ${n}`,
      base: false,
      cells: [{ name: null, x: 0, y: 0, w: 300, h: 100 }],
    })),
  },
];

/**
 * Bibliothèque des modèles de plans (armoires, boîtes, tiroirs). On crée un modèle ici, puis on
 * l'affecte à un contenant depuis son plan ; le contenant en reçoit alors une copie.
 */
export default function Plans() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const [plans, setPlans] = useState<PlanModel[] | null>(null);
  const [name, setName] = useState("");
  const [width, setWidth] = useState("300");
  const [height, setHeight] = useState("200");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presetIndex, setPresetIndex] = useState(0);

  async function createFromPreset() {
    const preset = PRESETS[presetIndex];
    setBusy(true);
    setError(null);
    try {
      const plan = await api.post<PlanModel>("/plans", {
        name: preset.name,
        width_mm: preset.width,
        height_mm: preset.height,
        levels: preset.levels as PlanLevel[],
      });
      navigate(`/plans/${plan.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    api
      .get<PlanModel[]>("/plans")
      .then(setPlans)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Liste indisponible."));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Donnez un nom au modèle.");
    setBusy(true);
    setError(null);
    try {
      const plan = await api.post<PlanModel>("/plans", {
        name: name.trim(),
        width_mm: Number(width),
        height_mm: Number(height),
        levels: [],
      });
      navigate(`/plans/${plan.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Plans</h1>
      <p className="muted small">
        Un plan est un modèle réutilisable (armoire, boîte, tiroir). Affectez-le à un contenant : il en crée les
        étages et les cases. Modifier le modèle ensuite ne change pas les contenants déjà affectés.
      </p>

      {canWrite && (
        <section className="card form">
          <h2>À partir d'un préréglage</h2>
          <select value={presetIndex} onChange={(e) => setPresetIndex(Number(e.target.value))}>
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={createFromPreset}>
            Créer ce plan
          </button>
          <p className="muted small">Le modèle est créé avec ses cases ; vous pouvez ensuite le modifier comme un autre.</p>
        </section>
      )}

      {canWrite && (
        <form className="card form" onSubmit={create}>
          <h2>Nouveau plan</h2>
          <input placeholder="Nom (ex. Armoire 4 tiroirs)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <label>
              Largeur (mm)
              <input type="number" min="1" value={width} onChange={(e) => setWidth(e.target.value)} />
            </label>
            <label>
              Profondeur (mm)
              <input type="number" min="1" value={height} onChange={(e) => setHeight(e.target.value)} />
            </label>
          </div>
          {error && <p className="error small">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Création…" : "Créer et dessiner le plan"}
          </button>
        </form>
      )}
      {!canWrite && error && <p className="error small">{error}</p>}

      <section className="card">
        <h2>Modèles{plans ? ` (${plans.length})` : ""}</h2>
        {plans === null && <p className="muted small">Chargement…</p>}
        {plans && plans.length === 0 && <p className="muted small">Aucun modèle pour l'instant.</p>}
        <ul className="list">
          {plans?.map((p) => {
            const cells = p.levels.reduce((total, l) => total + l.cells.length, 0);
            return (
              <li key={p.id}>
                <button type="button" className="linklike" onClick={() => navigate(`/plans/${p.id}`)}>
                  {p.name}
                </button>{" "}
                <span className="muted small">
                  {p.width_mm} × {p.height_mm} mm · {p.levels.length} étage(s) · {cells} case(s)
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
