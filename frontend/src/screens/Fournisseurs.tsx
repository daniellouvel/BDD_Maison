import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import type { Supplier } from "../types";

/** Fournisseurs : sites marchands et magasins où l'on achète. Les offres et prix sont dans « Achats ». */
export default function Fournisseurs() {
  const { canWrite } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [archived, setArchived] = useState<Supplier[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<Supplier[]>("/suppliers")
      .then(setSuppliers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Liste indisponible."));
    api
      .get<Supplier[]>("/suppliers/archived")
      .then(setArchived)
      .catch(() => setArchived([]));
  }

  async function restore(supplier: Supplier) {
    setError(null);
    try {
      await api.post(`/suppliers/${supplier.id}/restore`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restauration impossible.");
    }
  }

  useEffect(load, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/suppliers", { name: name.trim(), url: url.trim() || null, notes: notes.trim() || null });
      setName("");
      setUrl("");
      setNotes("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(supplier: Supplier) {
    if (!window.confirm(`Archiver « ${supplier.name} » ? Il n'apparaîtra plus dans les listes.`)) return;
    setError(null);
    try {
      await api.del(`/suppliers/${supplier.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Archivage impossible.");
    }
  }

  return (
    <div>
      <h1>Fournisseurs</h1>
      <p className="muted small">
        Où vous achetez : sites marchands, magasins. Les références et les prix par article se gèrent dans{" "}
        <a href="/achats">Achats</a>.
      </p>

      {canWrite && (
        <form className="card form" onSubmit={create}>
          <h2>Nouveau fournisseur</h2>
          <input placeholder="Nom (ex. Leroy Merlin)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Site web (optionnel)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input placeholder="Notes (optionnel)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <p className="error small">{error}</p>}
          <button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Création…" : "Ajouter"}
          </button>
        </form>
      )}
      {!canWrite && error && <p className="error small">{error}</p>}

      <section className="card">
        <h2>Liste{suppliers ? ` (${suppliers.length})` : ""}</h2>
        {suppliers === null && <p className="muted small">Chargement…</p>}
        {suppliers && suppliers.length === 0 && <p className="muted small">Aucun fournisseur pour l'instant.</p>}
        <ul className="list">
          {suppliers?.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong>
              {s.url && (
                <span className="muted small">
                  {" "}
                  · <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                </span>
              )}
              {s.notes && <span className="muted small"> · {s.notes}</span>}
              {canWrite && (
                <>
                  {" "}
                  <button type="button" className="linklike" onClick={() => archive(s)}>
                    Archiver
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canWrite && archived.length > 0 && (
        <section className="card">
          <h2>Archivés ({archived.length})</h2>
          <p className="muted small">Un fournisseur archivé ne figure plus dans les listes, mais son nom reste réservé.</p>
          <ul className="list">
            {archived.map((s) => (
              <li key={s.id}>
                <span className="muted">{s.name}</span>{" "}
                <button type="button" className="linklike" onClick={() => restore(s)}>
                  Restaurer
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
