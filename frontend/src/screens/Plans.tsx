import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { PlanModel } from "../types";

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
