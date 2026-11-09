import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import SimilarList from "../components/SimilarList";
import type { AiStatus, SearchHit, SimilarHit } from "../types";

export default function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  const [savedNow, setSavedNow] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoSearch, setPhotoSearch] = useState(false);
  const [photoHits, setPhotoHits] = useState<SimilarHit[] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    api
      .get<AiStatus>("/ai/status")
      .then((s) => setPhotoSearch(s.embeddings))
      .catch(() => setPhotoSearch(false));
  }, []);

  async function searchByPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    setParams({});
    const form = new FormData();
    form.append("file", file);
    try {
      setPhotoHits(await api.post<SimilarHit[]>("/search/by-image", form));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Recherche impossible.");
    } finally {
      setPhotoBusy(false);
    }
  }

  useEffect(() => {
    setInput(query);
    if (!query) {
      setHits(null);
      return;
    }
    setError(null);
    api
      .get<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`)
      .then(setHits)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Recherche impossible."));
  }, [query]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setPhotoHits(null);
    setSavedNow(false);
    setSaveError(null);
    setParams(input.trim() ? { q: input.trim() } : {});
  }

  return (
    <>
      <form className="searchbar" onSubmit={submit}>
        <input
          type="search"
          autoFocus
          placeholder="Nom, référence, marque, mot-clé…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          enterKeyHint="search"
        />
        <button type="submit">OK</button>
      </form>
      {query && (
        <p className="save-view">
          {savedNow ? (
            <span className="muted small">Recherche enregistrée.</span>
          ) : (
            <button
              type="button"
              className="linklike"
              onClick={async () => {
                const name = window.prompt("Nom de cette vue (ex. Résistances, Visserie)", query);
                if (!name?.trim()) return;
                try {
                  await api.post("/saved-searches", { name: name.trim(), query });
                  setSavedNow(true);
                } catch (e) {
                  setSaveError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
                }
              }}
            >
              ★ Enregistrer cette recherche
            </button>
          )}
          {saveError && <span className="error small"> {saveError}</span>}
        </p>
      )}
      {photoSearch && (
        <label className="filebutton">
          {photoBusy ? "Recherche…" : "Rechercher avec une photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              searchByPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      {photoHits && (
        <section className="card">
          <h2>Objets qui ressemblent à la photo</h2>
          {photoHits.length === 0 ? (
            <p className="muted">Aucun objet ressemblant parmi les photos de l'inventaire.</p>
          ) : (
            <SimilarList hits={photoHits} />
          )}
        </section>
      )}
      {hits && hits.length === 0 && <p className="muted">Aucun résultat pour « {query} ».</p>}
      {hits?.map((hit) => (
        <article key={hit.article.id} className="card">
          <h2>
            <Link to={`/articles/${hit.article.id}`}>{hit.article.name}</Link>
          </h2>
          <p className="muted">
            {[hit.article.brand, hit.article.mpn].filter(Boolean).join(" · ")}
          </p>
          <p>
            Stock total : <strong>{formatQty(hit.total_quantity)}</strong>
          </p>
          {hit.locations.length > 0 && (
            <ul className="list">
              {hit.locations.map((loc) => (
                <li key={loc.node_id}>
                  <Link to={`/nodes/${loc.node_id}`}>
                    {loc.path.length ? loc.path.join(" › ") : "Non localisé"}
                  </Link>
                  <span className="muted"> × {formatQty(loc.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </>
  );
}
