import { useEffect, useState } from "react";

const PHONE = "(max-width: 899px)";

/** Vrai sur un écran étroit (téléphone). Suit les changements de largeur. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const update = () => setPhone(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

const KEY = "mw_ui";

/** Choix de l'interface sur téléphone : « mobile » (par défaut) ou « classic ». Propre à l'appareil. */
export function readUiChoice(): "mobile" | "classic" {
  try {
    return window.localStorage.getItem(KEY) === "classic" ? "classic" : "mobile";
  } catch {
    return "mobile";
  }
}

export function saveUiChoice(choice: "mobile" | "classic"): void {
  try {
    window.localStorage.setItem(KEY, choice);
  } catch {
    // Stockage indisponible (navigation privée) : le choix vaut pour cette session seulement.
  }
}
