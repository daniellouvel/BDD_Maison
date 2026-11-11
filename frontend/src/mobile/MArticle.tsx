import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import LocationPicker from "../components/LocationPicker";
import { useLocation } from "../components/ItemLocation";
import { LotActions } from "../components/LotStatus";
import PlanView from "../components/PlanView";
import ArticleDetailScreen from "../screens/ArticleDetail";
import type { ArticleDetail, LocationRef, NodeDetail } from "../types";
import { LabelSheet } from "./MNode";
import { MHeader, Segmented, Sheet } from "./ui";

type Tab = "stock" | "plan" | "fiche";
type SheetName = "take" | "lend" | "move" | "label" | null;

/**
 * Fiche d'un objet sur téléphone. L'essentiel tient sur un écran : le stock total, les lots avec
 * leurs boutons − / +, et les trois actions du bas. La fiche complète est dans le second onglet.
 */
export default function MArticle() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { canWrite } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stock");
  const [selected, setSelected] = useState<string | null>(params.get("lot"));
  const [sheet, setSheet] = useState<SheetName>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  // Code de l'étiquette du lot choisi (null : aucune). Chargé à part : la liste des lots ne le donne pas.
  const [labelCode, setLabelCode] = useState<string | null>(null);
  // Fiche complète du lot choisi : sert à situer le lot sur le plan de sa boîte.
  const [lotNode, setLotNode] = useState<NodeDetail | null>(null);

  const load = useCallback(async () => {
    try {
      setArticle(await api.get<ArticleDetail>(`/articles/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
  }, [id]);

  useEffect(() => {
    setArticle(null);
    setError(null);
    void load();
  }, [load]);

  const lots = article?.locations ?? [];
  const lot: LocationRef | null = lots.find((l) => l.node_id === selected) ?? lots[0] ?? null;

  const lotId = lot?.node_id ?? null;
  const location = useLocation(lotNode);
  // Le lot choisi n'est dans aucun plan : on quitte l'onglet Plan.
  useEffect(() => {
    if (tab === "plan" && !location) setTab("stock");
  }, [tab, location]);
  const loadLabel = useCallback(() => {
    setLabelCode(null);
    setLotNode(null);
    if (!lotId) return;
    api
      .get<NodeDetail>(`/nodes/${lotId}`)
      .then((n) => {
        setLabelCode(n.qr_code);
        setLotNode(n);
      })
      .catch(() => setLabelCode(null));
  }, [lotId]);
  useEffect(loadLabel, [loadLabel]);

  /** Un appui sur − ou + : mouvement d'une unité, sans formulaire. */
  async function step(target: LocationRef, kind: "in" | "out") {
    setBusy(true);
    setError(null);
    try {
      await api.post("/stock/movements", { node_id: target.node_id, kind, delta: "1" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Mouvement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const done = () => {
    setSheet(null);
    void load();
  };

  return (
    <div className="m-view">
      <MHeader title={article?.name ?? "…"} subtitle={[article?.brand, article?.mpn].filter((v) => v && v !== article?.name).join(" · ") || null} back={-1} />

      {article && (
        <div className="m-stock">
          <span>
            <b>{formatQty(article.total_quantity)}</b> en stock
          </span>
          {article.min_quantity && <span>alerte sous {formatQty(article.min_quantity)}</span>}
        </div>
      )}
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "stock", label: `Lots (${lots.length})` },
          ...(location ? [{ value: "plan" as Tab, label: "Plan" }] : []),
          { value: "fiche", label: "Fiche" },
        ]}
      />

      <div className={`m-body${tab === "fiche" ? " m-pad m-notitle" : tab === "plan" ? " m-pad" : ""}`}>
        {error && <p className="error m-pad">{error}</p>}
        {!article && !error && <p className="m-empty">Chargement…</p>}

        {article && tab === "stock" && (
          <>
            {lots.length === 0 && <p className="m-empty">Aucun lot en stock pour cet article.</p>}
            <ul className="m-list">
              {lots.map((l) => (
                <li key={l.node_id}>
                  <div
                    className={`m-row${lot?.node_id === l.node_id && lots.length > 1 ? " sel" : ""}`}
                    onClick={() => setSelected(l.node_id)}
                  >
                    <span className="txt">
                      <b>{l.path.length ? l.path[l.path.length - 1] : "Non rangé"}</b>
                      <small>{l.path.length > 1 ? l.path.slice(0, -1).join(" › ") : l.path.length ? "Emplacement" : "À ranger"}</small>
                    </span>
                    {l.status === "lent" && <span className="m-badge">Prêté</span>}
                    {canWrite && l.status === "in_stock" ? (
                      <span className="m-step" onClick={(e) => e.stopPropagation()}>
                        <button type="button" aria-label="Retirer 1" disabled={busy || Number(l.quantity) <= 0} onClick={() => step(l, "out")}>
                          −
                        </button>
                        <b>{formatQty(l.quantity)}</b>
                        <button type="button" aria-label="Ajouter 1" disabled={busy} onClick={() => step(l, "in")}>
                          +
                        </button>
                      </span>
                    ) : (
                      <span className="end">
                        <b>{formatQty(l.quantity)}</b>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {lots.length > 1 && <p className="m-group">Touchez un lot pour le choisir, puis une action en bas.</p>}
          </>
        )}

        {article && tab === "plan" && location && (
          <>
            <p className="muted small" style={{ margin: "0 0 0.5rem" }}>
              Rangé dans <strong>« {location.names[location.cell] ?? "cette case"} »</strong> · {location.boxName}
            </p>
            <PlanView layout={location.layout} names={location.names} highlight={[location.cell]} initialLevel={location.level} />
          </>
        )}

        {article && tab === "fiche" && <ArticleDetailScreen articleId={article.id} />}
      </div>

      {lot && tab === "stock" && (
        <div className="m-actions m-label-line">
          {labelCode ? (
            <button type="button" className="secondary" onClick={() => navigate(`/qr/labels/${labelCode}`)}>
              🏷️ Étiquette {labelCode}
            </button>
          ) : canWrite ? (
            <button type="button" className="secondary" onClick={() => setSheet("label")}>
              🏷️ Associer une étiquette QR à ce lot
            </button>
          ) : (
            <span className="muted small">Pas d'étiquette QR</span>
          )}
        </div>
      )}

      {canWrite && lot && tab === "stock" && (
        <div className="m-actions">
          <button type="button" disabled={lot.status !== "in_stock"} onClick={() => setSheet("take")}>
            Prendre…
          </button>
          <button type="button" className="secondary" onClick={() => setSheet("lend")}>
            {lot.status === "lent" ? "Rendre" : "Prêter"}
          </button>
          <button type="button" className="secondary" disabled={lot.status !== "in_stock"} onClick={() => setSheet("move")}>
            Déplacer
          </button>
        </div>
      )}

      {sheet === "take" && lot && <TakeSheet lot={lot} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "lend" && lot && (
        <Sheet title={lot.status === "lent" ? "Rendre le lot" : "Prêter ou sortir le lot"} onClose={() => setSheet(null)}>
          <LotActions nodeId={lot.node_id} onDone={done} />
        </Sheet>
      )}
      {sheet === "move" && lot && <MoveLotSheet lot={lot} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "label" && lot && (
        <LabelSheet
          node={{ id: lot.node_id }}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            loadLabel();
          }}
        />
      )}
    </div>
  );
}

function TakeSheet({ lot, onClose, onDone }: { lot: LocationRef; onClose: () => void; onDone: () => void }) {
  const [quantity, setQuantity] = useState("1");
  const [kind, setKind] = useState<"out" | "consume" | "in">("out");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/stock/movements", { node_id: lot.node_id, kind, delta: quantity, reason: reason.trim() || null });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mouvement impossible.");
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Stock : ${formatQty(lot.quantity)} dans ce lot`} onClose={onClose}>
      <form className="m-form" onSubmit={submit}>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "out", label: "Sortir" },
            { value: "consume", label: "Consommer" },
            { value: "in", label: "Ajouter" },
          ]}
        />
        <label>
          Quantité
          <input type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
        </label>
        <input placeholder="Motif (facultatif)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="error small">{error}</p>}
        <button type="submit" disabled={busy || !(Number(quantity) > 0)}>
          Valider
        </button>
      </form>
    </Sheet>
  );
}

function MoveLotSheet({ lot, onClose, onDone }: { lot: LocationRef; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState<NodeDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/stock/movements", { node_id: lot.node_id, kind: "move", to_node_id: target.id });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Déplacement impossible.");
      setBusy(false);
    }
  }

  return (
    <Sheet title="Déplacer ce lot" onClose={onClose}>
      <div className="m-form">
        <LocationPicker value={target} onChange={setTarget} emptyLabel="à choisir" />
        {error && <p className="error small">{error}</p>}
        <button type="button" disabled={busy || !target} onClick={move}>
          Déplacer ici
        </button>
      </div>
    </Sheet>
  );
}
