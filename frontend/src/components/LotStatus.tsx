import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import type { LotStatus as Status, NodeDetail } from "../types";

export const STATUS_LABEL: Record<Status, string> = {
  in_stock: "En stock",
  lent: "Prêté",
  removed: "Sorti du stock",
};

/** Charge un lot puis affiche ses actions (prêter, rendre, sortir). */
export function LotActions({ nodeId, onDone }: { nodeId: string; onDone: () => void }) {
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api
      .get<NodeDetail>(`/nodes/${nodeId}`)
      .then(setNode)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Lot indisponible."));
  }

  // Relit le lot après chaque action : la version change à chaque écriture.
  useEffect(refresh, [nodeId]);

  if (error) return <p className="error small">{error}</p>;
  if (!node) return <p className="muted small">Chargement…</p>;
  return (
    <LotStatus
      node={node}
      onDone={() => {
        refresh();
        onDone();
      }}
    />
  );
}

/** Statut d'un lot, avec les actions prêter, rendre et sortir du stock. */
export default function LotStatus({ node, onDone }: { node: NodeDetail; onDone: () => void }) {
  const { canWrite } = useAuth();
  const [recipient, setRecipient] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: Status = node.status ?? "in_stock";

  async function lend(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/nodes/${node.id}/loan`, {
        version: node.version,
        recipient: recipient.trim(),
        due_at: due ? new Date(`${due}T12:00:00`).toISOString() : null,
      });
      setRecipient("");
      setDue("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Prêt impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function giveBack() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/nodes/${node.id}/return`, {});
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Retour impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Sortir ce lot du stock ?\n\nToute la quantité sera retirée du stock. Le lot ne sera plus modifiable.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/nodes/${node.id}/remove`, { version: node.version });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sortie impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lot-status">
      <p>
        Statut : <strong>{STATUS_LABEL[status]}</strong>
        {status === "lent" && " · l'objet est chez quelqu'un d'autre, sa quantité reste comptée dans le stock."}
      </p>

      {canWrite && status === "in_stock" && Number(node.quantity) > 0 && (
        <form className="form" onSubmit={lend}>
          <h3>Prêter ce lot</h3>
          <p className="muted small">Le lot entier ({formatQty(node.quantity, node.unit)}) est prêté.</p>
          <input placeholder="À qui ? (ex. Marc)" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          <label className="small">
            Retour prévu (facultatif)
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !recipient.trim()}>
            {busy ? "Enregistrement…" : "Prêter"}
          </button>
        </form>
      )}

      {canWrite && status === "lent" && (
        <button type="button" onClick={giveBack} disabled={busy}>
          Marquer rendu
        </button>
      )}

      {canWrite && status === "in_stock" && (
        <p>
          <button type="button" className="linklike" onClick={remove} disabled={busy}>
            Marquer sorti du stock
          </button>
        </p>
      )}

      {error && <p className="error small">{error}</p>}
    </div>
  );
}
