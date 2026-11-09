import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { AiStatus } from "../types";

const yesNo = (ok: boolean) => (ok ? "disponible" : "indisponible");

export default function Settings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AiStatus>("/ai/status")
      .then(setStatus)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible."));
  }, []);

  async function toggle(enabled: boolean) {
    setError(null);
    try {
      setStatus(await api.put<AiStatus>("/ai/settings", { remote_enabled: enabled }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }

  return (
    <section className="card">
      <h2>Intelligence artificielle</h2>
      <p className="muted small">
        L'IA ne fait que proposer : rien n'est enregistré sans votre validation, et la saisie manuelle
        reste toujours possible.
      </p>
      {error && <p className="error">{error}</p>}
      {status && (
        <>
          <ul className="list">
            <li>Lecture du texte et des références (sur le serveur) : {yesNo(status.ocr)}</li>
            <li>Recherche par photo et objets ressemblants (sur le serveur) : {yesNo(status.embeddings)}</li>
            <li>
              Identification par un service externe :{" "}
              {!status.remote_configured
                ? "non configurée sur le serveur"
                : status.remote_enabled
                  ? `activée (${status.remote_host})`
                  : `désactivée (${status.remote_host})`}
            </li>
          </ul>
          {status.remote_configured && user.role === "admin" && (
            <>
              <p className="small">
                <strong>Attention :</strong> une fois activée, le bouton « Identifier » envoie la photo
                à <code>{status.remote_host}</code>, hors de la maison. Avec une offre gratuite, le service
                peut utiliser ces photos pour améliorer ses modèles : n'identifiez pas de photos
                personnelles. Les quotas gratuits sont limités ; en cas de dépassement, la saisie
                manuelle continue de fonctionner.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={status.remote_enabled}
                  onChange={(e) => toggle(e.target.checked)}
                />
                Autoriser l'envoi de photos au service d'identification
              </label>
            </>
          )}
          {status.remote_configured && user.role !== "admin" && (
            <p className="muted small">Seul un administrateur peut changer ce réglage.</p>
          )}
        </>
      )}
    </section>
  );
}
