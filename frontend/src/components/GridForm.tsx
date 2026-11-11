import { useState } from "react";
import { gridRects } from "./planGeometry";

export type GridRect = { x: number; y: number; w: number; h: number };

/**
 * Génère d'un coup une grille de cases : « 8 colonnes sur 3 rangées » donne 24 cases de même taille,
 * réparties dans tout le plan. Les cases restent modifiables ensuite une à une.
 */
export default function GridForm({
  W,
  H,
  existing,
  busy = false,
  onGenerate,
}: {
  W: number;
  H: number;
  /** Nombre de cases déjà dans l'étage affiché. */
  existing: number;
  busy?: boolean;
  /** Reçoit les rectangles calculés et le préfixe des noms (« Case » donne Case 1, Case 2…). */
  onGenerate: (rects: GridRect[], prefix: string) => void | Promise<void>;
}) {
  const [cols, setCols] = useState("8");
  const [rows, setRows] = useState("3");
  const [margin, setMargin] = useState("0");
  const [gap, setGap] = useState("0");
  const [prefix, setPrefix] = useState("Case");
  const [error, setError] = useState<string | null>(null);

  const c = Number(cols);
  const r = Number(rows);
  const rects = Number.isInteger(c) && Number.isInteger(r) ? gridRects(W, H, c, r, Number(margin), Number(gap)) : null;
  const tooMany = rects !== null && rects.length > 200;
  const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

  async function generate() {
    setError(null);
    if (!rects) return setError("Cette grille ne tient pas dans le plan : réduisez le nombre de cases, la marge ou l'espacement.");
    if (tooMany) return setError("Maximum 200 cases à la fois.");
    if (existing > 0 && !window.confirm(`Remplacer les ${existing} case(s) de cet étage par ${rects.length} nouvelle(s) case(s) ?`)) return;
    await onGenerate(rects, prefix.trim() || "Case");
  }

  return (
    // Ouvert tant que l'étage est vide : c'est là qu'on définit ses cases. Replié ensuite pour ne pas gêner.
    <details className="grid-form" open={existing === 0 ? true : undefined}>
      <summary>Définir les cases : générer une grille (colonnes × rangées)</summary>
      <div className="plan-toolbar">
        <label>
          Colonnes
          <input type="number" min="1" max="50" value={cols} onChange={(e) => setCols(e.target.value)} />
        </label>
        <label>
          Rangées
          <input type="number" min="1" max="50" value={rows} onChange={(e) => setRows(e.target.value)} />
        </label>
        <label>
          Marge (mm)
          <input type="number" min="0" step="any" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </label>
        <label>
          Espace entre cases (mm)
          <input type="number" min="0" step="any" value={gap} onChange={(e) => setGap(e.target.value)} />
        </label>
        <label>
          Nom des cases
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
        <button type="button" disabled={busy || !rects || tooMany} onClick={generate}>
          {rects ? `Générer ${rects.length} cases` : "Générer"}
        </button>
      </div>
      <p className="muted small">
        {rects
          ? `${c} colonne(s) × ${r} rangée(s) : cases de ${fmt(rects[0].w)} × ${fmt(rects[0].h)} mm dans un plan de ${W} × ${H} mm.`
          : "Cette grille ne tient pas dans le plan (cases de moins de 10 mm ?)."}
      </p>
      {error && <p className="error small">{error}</p>}
    </details>
  );
}
