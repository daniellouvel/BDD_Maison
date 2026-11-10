import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { Loan, StockValue } from "../types";

function money(value: string): string {
  return `${Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}

/** Prêts en cours et valeur du stock. */
export default function Prets() {
  const { canWrite } = useAuth();
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [value, setValue] = useState<StockValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<Loan[]>("/loans?open=true")
      .then(setLoans)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Prêts indisponibles."));
    api
      .get<StockValue>("/stock/value")
      .then(setValue)
      .catch(() => setValue(null));
  }

  useEffect(load, []);

  async function giveBack(loan: Loan) {
    setError(null);
    try {
      await api.post(`/nodes/${loan.node_id}/return`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Retour impossible.");
    }
  }

  const now = Date.now();

  return (
    <div>
      <h1>Prêts et valeur du stock</h1>

      <section className="card">
        <h2>Valeur du stock</h2>
        {value === null && <p className="muted small">Chargement…</p>}
        {value && (
          <>
            <p>
              En stock : <strong>{money(value.in_stock)}</strong>
              {" · "}Prêté : <strong>{money(value.lent)}</strong>
            </p>
            <p className="muted small">
              Calculée avec le dernier prix saisi pour chaque article (écran Achats).
              {value.unpriced_lots > 0 && ` ${value.unpriced_lots} lot(s) sans prix ne sont pas comptés.`}
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>En cours{loans ? ` (${loans.length})` : ""}</h2>
        {error && <p className="error small">{error}</p>}
        {loans === null && <p className="muted small">Chargement…</p>}
        {loans && loans.length === 0 && <p className="muted small">Aucun prêt en cours.</p>}
        <ul className="list">
          {loans?.map((loan) => {
            const late = loan.due_at !== null && new Date(loan.due_at).getTime() < now;
            return (
              <li key={loan.id}>
                <strong>{loan.recipient}</strong> · <Link to={`/nodes/${loan.node_id}`}>{loan.node_name}</Link>
                <span className="muted small">
                  {" "}
                  · prêté le {day(loan.out_at)}
                  {loan.due_at && ` · retour prévu le ${day(loan.due_at)}`}
                </span>
                {late && <span className="error small"> · en retard</span>}
                {canWrite && (
                  <>
                    {" "}
                    <button type="button" className="linklike" onClick={() => giveBack(loan)}>
                      Marquer rendu
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
