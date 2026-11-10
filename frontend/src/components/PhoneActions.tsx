import { ReactNode, useState } from "react";
import { useAuth } from "../auth";
import type { NodeDetail } from "../types";
import LotStatus from "./LotStatus";
import MovementForm from "./MovementForm";

type Sheet = "take" | "lend" | null;

/**
 * Actions d'un objet sur téléphone : une barre fixe au-dessus de la barre d'onglets.
 * Chaque action ouvre une feuille du bas qui contient le formulaire existant.
 * Caché sur ordinateur (voir styles.css).
 */
export default function PhoneActions({
  node,
  onStartMove,
  onDone,
}: {
  node: NodeDetail;
  onStartMove: () => void;
  onDone: () => void;
}) {
  const { canWrite } = useAuth();
  const [sheet, setSheet] = useState<Sheet>(null);

  if (!canWrite || node.kind !== "item") return null;
  const status = node.status ?? "in_stock";
  if (status === "removed") return null;

  const close = () => setSheet(null);
  const done = () => {
    close();
    onDone();
  };

  return (
    <>
      <div className="phone-actions" role="toolbar" aria-label="Actions de l'objet">
        <button type="button" onClick={() => setSheet("take")} disabled={status !== "in_stock"}>
          Prendre
        </button>
        <button type="button" onClick={() => setSheet("lend")}>
          {status === "lent" ? "Rendre" : "Prêter"}
        </button>
        <button type="button" onClick={() => { onStartMove(); }} disabled={status !== "in_stock"}>
          Déplacer
        </button>
      </div>

      {sheet && (
        <Sheet title={sheet === "take" ? "Prendre dans le stock" : status === "lent" ? "Rendre le lot" : "Prêter le lot"} onClose={close}>
          {sheet === "take" ? <MovementForm nodeId={node.id} onDone={done} /> : <LotStatus node={node} onDone={done} />}
        </Sheet>
      )}
    </>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <strong>{title}</strong>
          <button type="button" className="secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
