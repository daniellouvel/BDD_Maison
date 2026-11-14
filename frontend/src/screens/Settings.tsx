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
    <>
    <DataExchange />
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
    </>
  );
}

type ImportReport = {
  dry_run: boolean;
  rows: number;
  articles_created: number;
  lots_created: number;
  places_created: number;
  problems: string[];
};

/** Sauvegarde de l'inventaire en tableur (CSV), et reprise d'un inventaire existant. */
function DataExchange() {
  const { canWrite } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      setReport(await api.post<ImportReport>(`/import/inventory?dry_run=${dryRun}`, form));
      if (!dryRun) setFile(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Données</h2>
      <p>
        <a className="button" href="/api/v1/export/inventory.csv" download>
          Exporter l'inventaire (CSV)
        </a>
      </p>
      <p className="muted small">Un lot par ligne : nom, marque, référence, catégorie, quantité, unité, emplacement, statut, étiquette. S'ouvre dans Excel ou LibreOffice.</p>
      {canWrite && (
        <>
          <h3>Importer un inventaire</h3>
          <p className="muted small">
            Colonnes reconnues : Nom (obligatoire), Marque, Référence, Catégorie, Quantité, Unité, Emplacement (ex. « Atelier &gt; Boîte vis &gt; Case 1 », créé s'il manque).
            Un aperçu est affiché avant d'importer.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
            }}
          />
          {file && (
            <div className="row">
              <button type="button" className="secondary" disabled={busy} onClick={() => run(true)}>
                Voir l'aperçu
              </button>
              {report?.dry_run && report.lots_created > 0 && (
                <button type="button" disabled={busy} onClick={() => run(false)}>
                  Importer {report.lots_created} lot(s)
                </button>
              )}
            </div>
          )}
          {report && (
            <p className="small">
              {report.dry_run ? "Aperçu : " : "Importé : "}
              {report.rows} ligne(s), {report.articles_created} nouvel(s) article(s), {report.lots_created} lot(s)
              {report.dry_run ? "" : `, ${report.places_created} emplacement(s) créé(s)`}.
            </p>
          )}
          {report?.problems.map((p) => (
            <p key={p} className="error small">
              {p}
            </p>
          ))}
          {error && <p className="error small">{error}</p>}
        </>
      )}
    </section>
  );
}
