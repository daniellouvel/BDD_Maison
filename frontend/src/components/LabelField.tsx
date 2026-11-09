import { useState } from "react";
import { normalizeCode } from "../qr";
import Scanner from "./Scanner";

/** Champ « Étiquette » : on saisit le code (QR-000001) ou on le scanne. */
export default function LabelField({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [scanning, setScanning] = useState(false);

  return (
    <div className="label-field">
      <div className="row">
        <input
          placeholder="Étiquette QR (ex. QR-000001)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const code = normalizeCode(value);
            if (code) onChange(code);
          }}
        />
        <button type="button" className="secondary" onClick={() => setScanning(!scanning)}>
          {scanning ? "Fermer" : "Scanner"}
        </button>
      </div>
      {scanning && (
        <Scanner
          hint="Scannez l'étiquette à coller"
          onCode={(text) => {
            onChange(normalizeCode(text) ?? text.trim());
            setScanning(false);
          }}
        />
      )}
    </div>
  );
}
