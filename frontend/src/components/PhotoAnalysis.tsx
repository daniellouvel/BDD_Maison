import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { AiStatus, Analysis, Article, Identification } from "../types";
import SimilarList from "./SimilarList";

/** Suggestions IA pour la photo d'un nouvel objet. Rien n'est appliqué sans un clic. */
export default function PhotoAnalysis({
  photo,
  onApply,
  onUseReference,
  onPickExisting,
  onAnalysis,
}: {
  photo: File;
  onApply: (identification: Identification) => void;
  onUseReference: (reference: string) => void;
  onPickExisting: (article: Article) => void;
  onAnalysis: (analysis: Analysis | null) => void;
}) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AiStatus>("/ai/status").then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    setAnalysis(null);
    setError(null);
    onAnalysis(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  if (!status || (!status.ocr && !status.embeddings && !status.remote_enabled)) return null;

  async function run(identify: boolean) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", photo);
    form.append("identify", identify ? "true" : "false");
    try {
      const result = await api.post<Analysis>("/ai/analyze", form);
      setAnalysis(result);
      onAnalysis(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Analyse impossible.");
    } finally {
      setBusy(false);
    }
  }

  const ident = analysis?.identification;

  return (
    <div className="ai-panel">
      <div className="row">
        <button type="button" className="secondary" disabled={busy} onClick={() => run(false)}>
          {busy ? "Analyse…" : "Analyser la photo"}
        </button>
        {status.remote_enabled && (
          <button type="button" className="secondary" disabled={busy} onClick={() => run(true)}>
            Identifier (IA externe)
          </button>
        )}
      </div>
      {status.remote_enabled && (
        <p className="muted small">« Identifier » envoie la photo à {status.remote_host}.</p>
      )}
      {error && <p className="error">{error}</p>}

      {analysis && (
        <>
          {analysis.warnings.map((w) => (
            <p key={w} className="muted small">
              ⚠ {w}
            </p>
          ))}

          {ident && (
            <div className="ai-block">
              <strong>Proposition : {ident.name ?? "objet non reconnu"}</strong>
              <p className="muted small">
                {[
                  ident.category && `Catégorie : ${ident.category}${ident.category_id ? "" : " (inexistante)"}`,
                  ident.brand && `Marque : ${ident.brand}`,
                  ident.mpn && `Réf. : ${ident.mpn}`,
                  ident.confidence != null && `Confiance : ${Math.round(ident.confidence * 100)} %`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {ident.description && <p className="small">{ident.description}</p>}
              <button type="button" onClick={() => onApply(ident)}>
                Appliquer à la fiche
              </button>
            </div>
          )}

          {analysis.similar.length > 0 && (
            <div className="ai-block">
              <strong>Ressemble à des objets déjà inventoriés</strong>
              <SimilarList hits={analysis.similar} onPick={onPickExisting} pickLabel="Ajouter du stock à" />
            </div>
          )}

          {analysis.parts.length > 0 && (
            <div className="ai-block">
              <strong>Références lues</strong>
              <ul className="list">
                {analysis.parts.map((p) => (
                  <li key={p.reference}>
                    <code>{p.reference}</code>{" "}
                    <button type="button" className="linklike" onClick={() => onUseReference(p.reference)}>
                      Utiliser
                    </button>{" "}
                    <a href={p.datasheet_url} target="_blank" rel="noreferrer">
                      Datasheet
                    </a>
                    {p.matches.map((m) => (
                      <div key={m.id} className="small">
                        Déjà en stock :{" "}
                        <button type="button" className="linklike" onClick={() => onPickExisting(m)}>
                          {m.name}
                        </button>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.ocr_text && (
            <details>
              <summary className="small">Texte lu</summary>
              <pre className="ocr">{analysis.ocr_text}</pre>
            </details>
          )}

          {!ident && analysis.similar.length === 0 && analysis.parts.length === 0 && !analysis.ocr_text && (
            <p className="muted small">Rien de reconnu : saisissez la fiche à la main.</p>
          )}
        </>
      )}
    </div>
  );
}
