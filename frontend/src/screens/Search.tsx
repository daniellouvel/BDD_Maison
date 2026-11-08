import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import type { SearchHit } from "../types";

export default function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      {error && <p className="error">{error}</p>}
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
