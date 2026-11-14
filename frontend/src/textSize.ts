const KEY = "mw_text";
export type TextSize = "normal" | "grand" | "tres-grand";
const SCALE: Record<TextSize, string> = { normal: "100%", grand: "115%", "tres-grand": "130%" };

export function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    return v === "grand" || v === "tres-grand" ? v : "normal";
  } catch {
    return "normal";
  }
}

/** Taille du texte choisie sur cet appareil (atelier mal éclairé, gants…). */
export function applyTextSize(size: TextSize): void {
  document.documentElement.style.fontSize = SCALE[size];
  try {
    localStorage.setItem(KEY, size);
  } catch {
    // Choix non mémorisé : valable jusqu'au prochain démarrage.
  }
}
