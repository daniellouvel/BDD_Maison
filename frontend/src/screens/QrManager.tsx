import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { extractCode } from "../qr";
import type { LabelLayout, QrStats, Sheet, SheetPreview } from "../types";

const pdfUrl = (sheet: Sheet) => `/api/v1/qr/sheets/${sheet.id}/pdf`;

export default function QrManager() {
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<QrStats | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [lookup, setLookup] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([api.get<QrStats>("/qr/stats"), api.get<Sheet[]>("/qr/sheets")]);
      setStats(s);
      setSheets(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openLabel(e: FormEvent) {
    e.preventDefault();
    const raw = lookup.trim();
    const code = /^\d{1,6}$/.test(raw) ? `QR-${raw.padStart(6, "0")}` : extractCode(raw);
    if (code) navigate(`/qr/labels/${code}`);
  }

  return (
    <>
      <h1>Étiquettes QR</h1>
      {error && <p className="error">{error}</p>}
      {stats && (
        <section className="stats">
          <div><strong>{stats.available}</strong>disponibles</div>
          <div><strong>{stats.assigned}</strong>affectées</div>
          <div><strong>{stats.disabled}</strong>désactivées</div>
          <div><strong>{stats.next_code}</strong>prochain code</div>
        </section>
      )}

      <form className="searchbar" onSubmit={openLabel}>
        <input placeholder="Retrouver une étiquette : QR-000123" value={lookup} onChange={(e) => setLookup(e.target.value)} />
        <button type="submit">Voir</button>
      </form>

      {canWrite && (
        <>
          <NewSheet onCreated={load} />
          <Reprint onCreated={load} />
        </>
      )}

      <section className="card">
        <h2>Planches imprimées ({stats?.sheets ?? 0})</h2>
        {sheets.length === 0 && <p className="muted">Aucune planche.</p>}
        <ul className="list">
          {sheets.map((s) => (
            <li key={s.id}>
              <a href={pdfUrl(s)} target="_blank" rel="noreferrer">
                Planche n° {s.number}
              </a>{" "}
              <span className="muted small">
                {s.first_code} → {s.last_code} · {s.label_count} étiquettes
                {s.start_position > 1 ? ` · dès la position ${s.start_position}` : ""} ·{" "}
                {new Date(s.created_at).toLocaleDateString("fr-FR")}
              </span>
              {s.is_reprint && <span className="badge badge-disabled"> réimpression</span>}
            </li>
          ))}
        </ul>
      </section>

      {canWrite && <LayoutSettings />}
      {stats && !stats.public_url && (
        <p className="muted small">
          Les QR contiennent seulement le code (ex. QR-000001) : ils se lisent avec le scanner de MyWorkshop.
        </p>
      )}
      <p className="small">
        <Link to="/scan">Scanner une étiquette</Link>
      </p>
    </>
  );
}

function NewSheet({ onCreated }: { onCreated: () => void }) {
  const [count, setCount] = useState("65");
  const [startPosition, setStartPosition] = useState("1");
  const [created, setCreated] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sheet = await api.post<Sheet>("/qr/sheets", {
        mode: "next",
        count: Number(count),
        start_position: Number(startPosition),
      });
      setCreated(sheet);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Génération impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Nouvelle planche</h2>
      <p className="muted small">Codes neufs, à la suite de la séquence. Aucun doublon possible.</p>
      <div className="row">
        <label>
          Nombre d'étiquettes
          <input type="number" min="1" max="65" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <label>
          Commencer à la position
          <input type="number" min="1" max="65" value={startPosition} onChange={(e) => setStartPosition(e.target.value)} />
        </label>
      </div>
      <p className="muted small">Position &gt; 1 : pour finir une planche déjà entamée (positions comptées ligne par ligne).</p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        Générer la planche
      </button>
      {created && (
        <p>
          Planche n° {created.number} : {created.first_code} → {created.last_code}.{" "}
          <a href={pdfUrl(created)} target="_blank" rel="noreferrer">
            Ouvrir le PDF à imprimer
          </a>
        </p>
      )}
    </form>
  );
}

function Reprint({ onCreated }: { onCreated: () => void }) {
  const [start, setStart] = useState("");
  const [count, setCount] = useState("1");
  const [startPosition, setStartPosition] = useState("1");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [created, setCreated] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const body = () => {
    const raw = start.trim();
    const code = /^\d{1,6}$/.test(raw) ? `QR-${raw.padStart(6, "0")}` : extractCode(raw);
    if (!code) throw new ApiError(422, "invalid", "Indiquez le premier code, ex. QR-000012.");
    return {
      mode: "range",
      start_seq: Number(code.slice(3)),
      count: Number(count),
      start_position: Number(startPosition),
    };
  };

  async function check(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setConfirmed(false);
    try {
      setPreview(await api.post<SheetPreview>("/qr/sheets/preview", body()));
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : "Vérification impossible.");
    }
  }

  async function generate() {
    setError(null);
    try {
      const sheet = await api.post<Sheet>("/qr/sheets", { ...body(), confirm_reprint: confirmed });
      setCreated(sheet);
      setPreview(null);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Génération impossible.");
    }
  }

  return (
    <section className="card">
      <form className="form" onSubmit={check}>
        <h2>Réimprimer des étiquettes existantes</h2>
        <p className="muted small">Pour remplacer une étiquette abîmée à l'identique (même code).</p>
        <div className="row">
          <label>
            Premier code
            <input placeholder="QR-000012" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label>
            Nombre
            <input type="number" min="1" max="65" value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <label>
            Position
            <input type="number" min="1" max="65" value={startPosition} onChange={(e) => setStartPosition(e.target.value)} />
          </label>
        </div>
        <button type="submit" className="secondary">
          Vérifier
        </button>
      </form>
      {preview && (
        <div className="warning">
          <p>
            <strong>Attention : {preview.already_printed.length} code(s) déjà imprimé(s).</strong> Chaque code
            réimprimé existera en double : ne collez la nouvelle étiquette qu'à la place de l'ancienne.
          </p>
          <ul className="small">
            {preview.already_printed.map((c) => (
              <li key={c.code}>
                {c.code} : imprimé {c.print_count} fois, {c.status === "assigned" ? "affecté" : c.status === "available" ? "vierge" : "désactivé"}
              </li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Je confirme la réimpression de ces codes
          </label>
          <button type="button" onClick={generate} disabled={!confirmed}>
            Générer la réimpression
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {created && (
        <p>
          Réimpression n° {created.number} prête.{" "}
          <a href={pdfUrl(created)} target="_blank" rel="noreferrer">
            Ouvrir le PDF
          </a>
        </p>
      )}
    </section>
  );
}

const LAYOUT_FIELDS: { key: keyof LabelLayout; label: string; step?: string }[] = [
  { key: "columns", label: "Colonnes", step: "1" },
  { key: "rows", label: "Lignes", step: "1" },
  { key: "margin_left", label: "Marge gauche (mm)" },
  { key: "margin_top", label: "Marge haute (mm)" },
  { key: "label_width", label: "Largeur étiquette (mm)" },
  { key: "label_height", label: "Hauteur étiquette (mm)" },
  { key: "pitch_x", label: "Pas horizontal (mm)" },
  { key: "pitch_y", label: "Pas vertical (mm)" },
  { key: "qr_size", label: "Taille du QR (mm)" },
  { key: "font_size", label: "Taille du numéro (pt)" },
];

function LayoutSettings() {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<LabelLayout | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open && !layout) api.get<LabelLayout>("/qr/layout").then(setLayout).catch(() => setLayout(null));
  }, [open, layout]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!layout) return;
    try {
      setLayout(await api.put<LabelLayout>("/qr/layout", layout));
      setMessage("Gabarit enregistré. Imprimez une planche d'essai pour vérifier l'alignement.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    }
  }

  return (
    <section className="card">
      <button type="button" className="linklike" onClick={() => setOpen(!open)}>
        {open ? "Masquer le gabarit d'impression" : "Gabarit d'impression (dimensions, marges)…"}
      </button>
      {open && layout && (
        <form className="form" onSubmit={save}>
          <p className="muted small">
            Imprimez à 100 % (sans « ajuster à la page »). La planche d'essai trace le contour de chaque étiquette
            sans consommer de codes.
          </p>
          <div className="grid2">
            {LAYOUT_FIELDS.map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type="number"
                  step={f.step ?? "0.1"}
                  value={String(layout[f.key])}
                  onChange={(e) => setLayout({ ...layout, [f.key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          {message && <p className="small">{message}</p>}
          <div className="row">
            <button type="submit">Enregistrer</button>
            <a className="button secondary" href="/api/v1/qr/layout/test.pdf" target="_blank" rel="noreferrer">
              Planche d'essai (PDF)
            </a>
          </div>
        </form>
      )}
    </section>
  );
}
