import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

type ToastData = { id: number; text: string; undo?: () => Promise<void> };
type Listener = (t: ToastData | null) => void;

let listener: Listener | null = null;
let counter = 0;

/** Message bref en bas de l'écran ; avec `undo`, un bouton « Annuler » reste actif quelques secondes. */
export function notify(text: string, undo?: () => Promise<void>): void {
  listener?.({ id: ++counter, text, undo });
}

/** Annule un mouvement de stock déjà enregistré (l'inverse est écrit au journal). */
export function undoMovement(movementId: string, onDone?: () => void): () => Promise<void> {
  return async () => {
    try {
      await api.post(`/stock/movements/${movementId}/undo`);
      notify("Annulé");
      onDone?.();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Annulation impossible.");
    }
  };
}

export function Toasts() {
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    listener = setToast;
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.undo ? 6000 : 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            const run = toast.undo;
            setToast(null);
            void run?.();
          }}
        >
          Annuler
        </button>
      )}
    </div>
  );
}
