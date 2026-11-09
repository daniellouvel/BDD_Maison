import { FormEvent, useState } from "react";
import { api, ApiError, newId } from "../api";
import type { Movement } from "../types";

const KINDS = [
  { value: "in", label: "Entrée (+)" },
  { value: "out", label: "Sortie (−)" },
  { value: "consume", label: "Consommation (−)" },
  { value: "adjust", label: "Ajustement (±, justifié)" },
] as const;

/** Mouvement de stock sur un lot. Les quantités de sortie se saisissent en positif. */
export default function MovementForm({ nodeId, onDone }: { nodeId: string; onDone: () => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("out");
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<Movement>("/stock/movements", {
        op_id: newId(),
        node_id: nodeId,
        kind,
        delta,
        reason: reason || null,
      });
      setReason("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mouvement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        aria-label="Quantité"
        required
      />
      <input
        placeholder={kind === "adjust" ? "Motif (obligatoire)" : "Motif (facultatif)"}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required={kind === "adjust"}
      />
      <button type="submit" disabled={busy}>
        Valider
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
