import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import LocationPicker from "../components/LocationPicker";
import type { Article, NodeDetail, Purchase } from "../types";
import { MHeader, Segmented, Sheet } from "./ui";

type Tab = "to_buy" | "ordered" | "received";

function euro(value: string | null): string | null {
  if (!value) return null;
  return `${Number(value).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Liste de courses sur téléphone : la liste au centre, l'ajout rapide en bas, les actions au toucher. */
export default function MShopping() {
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [tab, setTab] = useState<Tab>("to_buy");
  const [open, setOpen] = useState<Purchase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Purchase[]>("/purchases")
      .then(setPurchases)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Liste indisponible."));
  }, []);

  useEffect(load, [load]);

  const count = (s: Tab) => purchases?.filter((p) => p.status === s).length ?? 0;
  const visible = purchases?.filter((p) => p.status === tab) ?? [];

  return (
    <div className="m-view">
      <MHeader
        title="Courses"
        action={
          <button type="button" className="m-icon" style={{ width: "auto", padding: "0 0.6rem", fontSize: "0.9rem", borderRadius: 999 }} onClick={() => navigate("/achats/prix")}>
            Prix
          </button>
        }
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "to_buy", label: `À acheter (${count("to_buy")})` },
          { value: "ordered", label: `Commandé (${count("ordered")})` },
          { value: "received", label: "Reçus" },
        ]}
      />

      <div className="m-body">
        {error && <p className="error m-pad">{error}</p>}
        {purchases === null && !error && <p className="m-empty">Chargement…</p>}
        {purchases !== null && visible.length === 0 && (
          <p className="m-empty">{tab === "to_buy" ? "Rien à acheter. Ajoutez une ligne en bas." : "Rien ici."}</p>
        )}
        <ul className="m-list">
          {visible.map((p) => (
            <li key={p.id}>
              <button type="button" className="m-row" onClick={() => setOpen(p)} disabled={!canWrite || p.status === "received"}>
                <span className="ic">{p.status === "received" ? "✅" : p.status === "ordered" ? "📦" : "🛒"}</span>
                <span className="txt">
                  <b>{p.label}</b>
                  <small>{[p.supplier_name, euro(p.unit_price), p.article_id ? null : "sans article lié"].filter(Boolean).join(" · ") || " "}</small>
                </span>
                <span className="end">
                  <b>× {formatQty(p.quantity)}</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {canWrite && tab === "to_buy" && <QuickAdd onAdded={load} />}

      {open && (
        <PurchaseSheet
          purchase={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Ajout en une ligne. Les articles du catalogue sont proposés pendant la frappe. */
function QuickAdd({ onAdded }: { onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [article, setArticle] = useState<Article | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [hits, setHits] = useState<Article[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = label.trim();
    if (article || term.length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<Article[]>(`/articles?q=${encodeURIComponent(term)}&limit=5`)
        .then(setHits)
        .catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [label, article]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/purchases", {
        article_id: article?.id ?? null,
        // Avec un article, le serveur reprend son nom comme libellé.
        label: article ? "" : label.trim(),
        quantity: quantity || "1",
      });
      setLabel("");
      setArticle(null);
      setQuantity("1");
      setHits([]);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ajout impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="m-quick" onSubmit={submit}>
      {(hits.length > 0 || error) && (
        <ul className="m-suggest">
          {error && <li className="error small m-pad">{error}</li>}
          {hits.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="m-row"
                onClick={() => {
                  setArticle(a);
                  setLabel(a.name);
                  setHits([]);
                }}
              >
                <span className="ic">🔩</span>
                <span className="txt">
                  <b>{a.name}</b>
                  <small>Article du catalogue</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        placeholder="Ajouter à la liste…"
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
          setArticle(null);
        }}
        aria-label="Article ou libellé"
      />
      <input className="qty" type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantité" />
      <button type="submit" disabled={busy || !label.trim()} aria-label="Ajouter">
        ＋
      </button>
    </form>
  );
}

function PurchaseSheet({ purchase, onClose, onDone }: { purchase: Purchase; onClose: () => void; onDone: () => void }) {
  const [receiving, setReceiving] = useState(false);
  const [target, setTarget] = useState<NodeDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      setBusy(false);
    }
  }

  const setStatus = (status: "ordered" | "cancelled") =>
    run(() => api.patch(`/purchases/${purchase.id}`, { version: purchase.version, status }), "Modification impossible.");

  return (
    <Sheet title={`${purchase.label} × ${formatQty(purchase.quantity)}`} onClose={onClose}>
      {!receiving && (
        <div className="m-menu">
          {purchase.status === "to_buy" && (
            <button type="button" disabled={busy} onClick={() => setStatus("ordered")}>
              Marquer commandé
            </button>
          )}
          {purchase.article_id ? (
            <button type="button" disabled={busy} onClick={() => setReceiving(true)}>
              Reçu : ranger dans un emplacement
            </button>
          ) : (
            <p className="muted small">Sans article lié, la réception ne range rien : retirez la ligne une fois l'achat fait.</p>
          )}
          <button type="button" className="danger" disabled={busy} onClick={() => setStatus("cancelled")}>
            {purchase.article_id ? "Annuler cet achat" : "Retirer de la liste"}
          </button>
        </div>
      )}
      {receiving && (
        <div className="m-form">
          <LocationPicker value={target} onChange={setTarget} emptyLabel="à choisir" />
          <button
            type="button"
            disabled={busy || !target}
            onClick={() =>
              target &&
              run(() => api.post(`/purchases/${purchase.id}/receive`, { version: purchase.version, node_id: target.id }), "Réception impossible.")
            }
          >
            Ranger ici ({formatQty(purchase.quantity)})
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </Sheet>
  );
}
