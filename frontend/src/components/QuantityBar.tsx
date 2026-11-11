import { useState } from "react";
import { api, ApiError, formatQty } from "../api";
import type { NodeDetail } from "../types";
import MovementForm from "./MovementForm";

/**
 * Quantité d'un lot, en haut de la fiche : − et + changent le stock d'une unité tout de suite,
 * « Autre quantité… » ouvre le formulaire complet (sortir, consommer, ajouter, ajuster, déplacer).
 */
export default function QuantityBar({ node, onDone }: { node: NodeDetail; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quantity = Number(node.quantity ?? 0);

  async function step(kind: "in" | "out") {
    setBusy(true);
    setError(null);
    try {
      await api.post("/stock/movements", { node_id: node.id, kind, delta: "1" });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Mouvement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quantity-bar">
      <div className="quantity-line">
        <span className="muted">Quantité</span>
        <button type="button" className="secondary" aria-label="Retirer 1" disabled={busy || quantity <= 0} onClick={() => step("out")}>
          −
        </button>
        <strong className="quantity-value">{formatQty(node.quantity, node.unit)}</strong>
        <button type="button" className="secondary" aria-label="Ajouter 1" disabled={busy} onClick={() => step("in")}>
          +
        </button>
        <button type="button" className="linklike" onClick={() => setOpen(!open)}>
          {open ? "Fermer" : "Autre quantité…"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      {open && (
        <MovementForm
          nodeId={node.id}
          onDone={() => {
            setOpen(false);
            onDone();
          }}
        />
      )}
    </div>
  );
}
