import { useState } from "react";
import { ApiError } from "../api";
import { fetchLabel } from "../qr";
import Scanner from "./Scanner";

/** Choix d'une étiquette vierge (disponible) par scan, pour l'affecter après l'enregistrement. */
export default function LabelPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(code: string) {
    setError(null);
    try {
      const label = await fetchLabel(code);
      if (label.status !== "available") {
        setError(
          label.status === "assigned"
            ? `${code} est déjà affectée à « ${label.node?.name ?? label.node?.article_name ?? "un élément"} ».`
            : `${code} est désactivée.`,
        );
        return;
      }
      onChange(code);
      setScanning(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Vérification impossible.");
    }
  }

  if (value) {
    return (
      <p className="label-chip">
        Étiquette : <strong>{value}</strong>{" "}
        <button type="button" className="linklike" onClick={() => onChange(null)}>
          Retirer
        </button>
      </p>
    );
  }

  return (
    <div>
      {scanning ? (
        <>
          <Scanner onCode={check} hint="Scannez une étiquette vierge" />
          <button type="button" className="secondary" onClick={() => setScanning(false)}>
            Annuler le scan
          </button>
        </>
      ) : (
        <button type="button" className="secondary" onClick={() => setScanning(true)}>
          Scanner une étiquette QR vierge (facultatif)
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
