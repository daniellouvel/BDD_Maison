import { api } from "./api";
import type { Label, LabelStatus } from "./types";

const CODE_RE = /QR-?(\d{1,6})(?!\d)/i;

/** Extrait « QR-000123 » d'un texte scanné (code seul ou URL https://…/l/QR-000123). */
export function extractCode(text: string): string | null {
  const match = CODE_RE.exec(text);
  if (!match || Number(match[1]) === 0) return null;
  return `QR-${match[1].padStart(6, "0")}`;
}

export const fetchLabel = (code: string) => api.get<Label>(`/qr/labels/${encodeURIComponent(code)}`);

export const STATUS_LABEL: Record<LabelStatus, string> = {
  available: "Disponible",
  assigned: "Affectée",
  disabled: "Désactivée",
};

export const EVENT_LABEL: Record<string, string> = {
  created: "Créée",
  printed: "Imprimée",
  reprinted: "Réimprimée",
  assigned: "Affectée",
  disabled: "Désactivée",
  replaced: "Remplacée",
  reactivated: "Réactivée",
};
