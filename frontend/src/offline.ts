import { useSyncExternalStore } from "react";

/**
 * File d'attente des mouvements de stock saisis sans réseau. Chaque mouvement porte un `op_id` : le
 * serveur ignore un rejeu, donc un envoi dont la réponse s'est perdue ne compte jamais deux fois.
 * La file est gardée dans le navigateur (localStorage) et vidée dans l'ordre dès que le serveur répond.
 */

const KEY = "mw_outbox";

export type QueuedMovement = { op_id: string; body: Record<string, unknown>; at: number };

let memory: QueuedMovement[] | null = null;
const listeners = new Set<() => void>();

function read(): QueuedMovement[] {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    memory = Array.isArray(parsed) ? parsed : [];
  } catch {
    memory = [];
  }
  return memory;
}

function write(list: QueuedMovement[]): void {
  memory = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Stockage plein ou bloqué : la file reste en mémoire pour cette session.
  }
  listeners.forEach((l) => l());
}

export function pendingCount(): number {
  return read().length;
}

export function enqueueMovement(body: Record<string, unknown>): string {
  const opId = String(body.op_id);
  write([...read(), { op_id: opId, body, at: Date.now() }]);
  return opId;
}

/** Retire un mouvement encore en attente (annulation avant envoi). Vrai s'il y était. */
export function dropQueued(opId: string): boolean {
  const list = read();
  const next = list.filter((m) => m.op_id !== opId);
  if (next.length === list.length) return false;
  write(next);
  return true;
}

let flushing = false;
let lastReport: ((text: string) => void) | null = null;

export function onFlushReport(fn: (text: string) => void): void {
  lastReport = fn;
}

/** Envoie les mouvements en attente, du plus ancien au plus récent. S'arrête si le réseau manque encore. */
export async function flushQueue(): Promise<void> {
  if (flushing || read().length === 0) return;
  flushing = true;
  let sent = 0;
  const refused: string[] = [];
  try {
    for (const item of [...read()]) {
      let response: Response;
      try {
        response = await fetch("/api/v1/stock/movements", {
          method: "POST",
          headers: { "X-Requested-With": "myworkshop", "Content-Type": "application/json" },
          body: JSON.stringify(item.body),
          credentials: "same-origin",
        });
      } catch {
        break; // toujours pas de réseau : on réessaiera
      }
      if (response.status === 401 || response.status >= 500) break; // session expirée ou serveur en difficulté
      if (response.ok) {
        sent += 1;
      } else {
        const data = await response.json().catch(() => null);
        refused.push(data?.message ?? `Erreur ${response.status}`);
      }
      write(read().filter((m) => m.op_id !== item.op_id));
    }
  } finally {
    flushing = false;
  }
  if (lastReport && (sent > 0 || refused.length > 0)) {
    const parts = [];
    if (sent > 0) parts.push(`${sent} mouvement(s) envoyé(s)`);
    if (refused.length > 0) parts.push(`${refused.length} refusé(s) : ${refused[0]}`);
    lastReport(parts.join(" · "));
  }
}

export function usePending(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    pendingCount,
  );
}
