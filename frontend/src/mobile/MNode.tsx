import { FormEvent, useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import LabelField from "../components/LabelField";
import LocationPicker from "../components/LocationPicker";
import PlanPreview from "../components/PlanPreview";
import Scanner from "../components/Scanner";
import { normalizeCode } from "../qr";
import type { Node, NodeDetail, NodeKind } from "../types";
import { MHeader, Segmented, Sheet } from "./ui";

import { notify } from "../toast";
import RowIcon from "../components/RowIcon";
const ICON: Record<NodeKind, string> = { location: "🏠", container: "📦", item: "🔩" };

type SheetName = "menu" | "add" | "rename" | "move" | "label" | "plan" | "count" | null;

/** Lieux : un seul niveau à l'écran. On entre dans un emplacement en le touchant, on remonte avec « retour ». */
export default function MNode() {
  const { id } = useParams();
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [kids, setKids] = useState<Node[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = id ? await api.get<NodeDetail>(`/nodes/${id}`) : null;
      const list = await api.get<Node[]>(detail ? `/nodes?parent_id=${detail.id}` : "/nodes");
      setNode(detail);
      setKids(list);
      // Un objet sans nom porte celui de son article.
      const ids = [...new Set(list.filter((n) => !n.name && n.article_id).map((n) => n.article_id as string))];
      const found: Record<string, string> = {};
      await Promise.all(
        ids.map(async (aid) => {
          try {
            found[aid] = (await api.get<{ name: string }>(`/articles/${aid}`)).name;
          } catch {
            // Nom indisponible : la ligne affichera « Objet ».
          }
        }),
      );
      setNames(found);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
  }, [id]);

  useEffect(() => {
    setNode(null);
    setKids(null);
    setSheet(null);
    void load();
  }, [load]);

  // Un objet s'affiche dans sa fiche, avec ce lot sélectionné.
  if (node && node.kind === "item" && node.article_id) {
    return <Navigate to={`/a/${node.article_id}?lot=${node.id}`} replace />;
  }

  const parents = node ? node.breadcrumb.slice(0, -1).map((b) => b.name) : [];
  const subtitle = node ? [parents.join(" › "), node.qr_code].filter(Boolean).join(" · ") || null : null;
  const back = node ? (node.parent_id ? `/e/${node.parent_id}` : "/lieux") : undefined;

  const open = (k: Node) => navigate(k.kind === "item" && k.article_id ? `/a/${k.article_id}?lot=${k.id}` : `/e/${k.id}`);
  const label = (k: Node) => k.name ?? (k.article_id ? names[k.article_id] : null) ?? (k.kind === "item" ? "Objet" : "Sans nom");

  const unplaced = !id && kids ? kids.filter((k) => k.kind !== "location") : [];
  const main = !id && kids ? kids.filter((k) => k.kind === "location") : (kids ?? []);

  async function remove() {
    if (!node) return;
    const warning =
      "Tout ce qui est dedans sera supprimé (étages, cases, contenants, objets).\n" +
      "Rien n'est effacé définitivement, mais ces éléments ne figureront plus dans l'inventaire.";
    if (!window.confirm(`Supprimer « ${node.name ?? "cet élément"} » ?\n\n${warning}`)) return;
    const done = () => navigate(node.parent_id ? `/e/${node.parent_id}` : "/lieux", { replace: true });
    try {
      await api.post(`/nodes/${node.id}/archive-tree`, {});
      done();
    } catch (e) {
      if (e instanceof ApiError && e.code === "stock_remaining") {
        if (!window.confirm(`${e.message}\n\nSupprimer aussi ce stock ? Il sera sorti du stock.`)) return;
        try {
          await api.post(`/nodes/${node.id}/archive-tree?remove_stock=true`, {});
          done();
        } catch (e2) {
          setError(e2 instanceof ApiError ? e2.message : "Suppression impossible.");
        }
        return;
      }
      setError(e instanceof ApiError ? e.message : "Suppression impossible.");
    } finally {
      setSheet(null);
    }
  }

  const rows = (list: Node[]) =>
    list.map((k) => (
      <li key={k.id}>
        <button type="button" className="m-row" onClick={() => open(k)}>
          <RowIcon photoId={k.photo_id} fallback={ICON[k.kind]} />
          <span className="txt">
            <b>{label(k)}</b>
          </span>
          <span className="end">{k.kind === "item" ? <b>{formatQty(k.quantity, k.unit)}</b> : "›"}</span>
        </button>
      </li>
    ));

  return (
    <div className="m-view">
      <MHeader
        title={id ? (node?.name ?? "…") : "Lieux"}
        subtitle={subtitle}
        back={back}
        action={
          node && canWrite ? (
            <button type="button" className="m-icon" aria-label="Actions" onClick={() => setSheet("menu")}>
              ⋯
            </button>
          ) : undefined
        }
      />

      <div className="m-body">
        {error && <p className="error m-pad">{error}</p>}
        {kids === null && !error && <p className="m-empty">Chargement…</p>}
        {unplaced.length > 0 && (
          <>
            <p className="m-group">À ranger ({unplaced.length})</p>
            <ul className="m-list">{rows(unplaced)}</ul>
            <p className="m-group">Emplacements</p>
          </>
        )}
        <ul className="m-list">{rows(main)}</ul>
        {kids !== null && kids.length === 0 && (
          <p className="m-empty">{id ? "Vide. Ajoutez un contenant ou rangez un objet ici." : "Aucun emplacement pour l'instant."}</p>
        )}
      </div>

      {canWrite && (
        <div className="m-actions">
          <button type="button" className={node ? "secondary" : ""} onClick={() => setSheet("add")}>
            {node ? "＋ Contenant" : "＋ Emplacement"}
          </button>
          {node && (
            <button type="button" onClick={() => navigate(`/ranger?to=${node.id}`)}>
              ＋ Ranger un objet ici
            </button>
          )}
        </div>
      )}

      {sheet === "menu" && node && (
        <Sheet title={node.name ?? "Actions"} onClose={() => setSheet(null)}>
          <div className="m-menu">
            <button type="button" onClick={() => setSheet("rename")}>Renommer</button>
            <button type="button" onClick={() => setSheet("move")}>Déplacer</button>
            <button type="button" onClick={() => setSheet("plan")}>Plan (étages et cases)</button>
            {(kids ?? []).some((k) => k.kind === "item") && (
              <button type="button" onClick={() => setSheet("count")}>Compter le contenu</button>
            )}
            {node.qr_code ? (
              <button type="button" onClick={() => navigate(`/qr/labels/${node.qr_code}`)}>Étiquette {node.qr_code}</button>
            ) : (
              <button type="button" onClick={() => setSheet("label")}>Associer une étiquette QR</button>
            )}
            <button type="button" className="danger" onClick={remove}>Supprimer</button>
          </div>
        </Sheet>
      )}

      {sheet === "count" && node && kids && (
        <CountSheet
          title={node.name ?? "Contenu"}
          items={kids.filter((k) => k.kind === "item" && k.status === "in_stock")}
          names={names}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            void load();
          }}
        />
      )}

      {sheet === "add" && (
        <AddSheet
          parent={node}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            void load();
          }}
        />
      )}

      {sheet === "rename" && node && (
        <RenameSheet
          node={node}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            void load();
          }}
        />
      )}

      {sheet === "move" && node && (
        <MoveSheet
          node={node}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            void load();
          }}
        />
      )}

      {sheet === "label" && node && (
        <LabelSheet
          node={node}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            void load();
          }}
        />
      )}

      {sheet === "plan" && node && (
        <Sheet title="Plan" onClose={() => setSheet(null)}>
          <PlanPreview key={node.id} node={node} canWrite={canWrite} onChanged={load} />
        </Sheet>
      )}
    </div>
  );
}

function AddSheet({ parent, onClose, onDone }: { parent: NodeDetail | null; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"location" | "container">(parent ? "container" : "location");
  const [name, setName] = useState("");
  const [labelCode, setLabelCode] = useState("");
  // Identifiant de l'élément déjà créé : si l'étiquette échoue, on réessaie sans le recréer.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!createdId && !name.trim()) return;
    setBusy(true);
    setError(null);
    let id = createdId;
    try {
      if (!id) {
        id = (await api.post<{ id: string }>("/nodes", { kind, name: name.trim(), parent_id: parent?.id ?? null })).id;
        setCreatedId(id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ajout impossible.");
      setBusy(false);
      return;
    }
    if (labelCode.trim()) {
      try {
        await api.post(`/qr/labels/${normalizeCode(labelCode) ?? labelCode.trim().toUpperCase()}/assign`, { node_id: id });
      } catch (err) {
        setError(`Créé, mais l'étiquette n'a pas pu être associée : ${err instanceof ApiError ? err.message : "erreur"}`);
        setBusy(false);
        return;
      }
    }
    onDone();
  }

  return (
    <Sheet title={parent ? `Ajouter dans ${parent.name ?? "cet élément"}` : "Nouvel emplacement"} onClose={onClose}>
      <form className="m-form" onSubmit={submit}>
        {parent && (
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "container", label: "Contenant (boîte, tiroir)" },
              { value: "location", label: "Emplacement" },
            ]}
          />
        )}
        <input
          placeholder={kind === "container" ? "Nom (ex. Boîte vis M3)" : "Nom (ex. Atelier)"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={createdId !== null}
          autoFocus
        />
        <label>
          Étiquette QR à coller dessus (facultatif)
          <LabelField value={labelCode} onChange={setLabelCode} />
        </label>
        {error && <p className="error small">{error}</p>}
        <button type="submit" disabled={busy || (!createdId && !name.trim())}>
          {busy ? "Ajout…" : createdId ? "Réessayer l'étiquette" : "Ajouter"}
        </button>
        {createdId && (
          <button type="button" className="secondary" onClick={onDone}>
            Continuer sans étiquette
          </button>
        )}
      </form>
    </Sheet>
  );
}

function RenameSheet({ node, onClose, onDone }: { node: NodeDetail; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(node.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/nodes/${node.id}`, { version: node.version, name: name.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Modification impossible.");
      setBusy(false);
    }
  }

  return (
    <Sheet title="Renommer" onClose={onClose}>
      <form className="m-form" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        {error && <p className="error small">{error}</p>}
        <button type="submit" disabled={busy || !name.trim()}>
          Enregistrer
        </button>
      </form>
    </Sheet>
  );
}

function MoveSheet({ node, onClose, onDone }: { node: NodeDetail; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState<NodeDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(parentId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/nodes/${node.id}`, { version: node.version, parent_id: parentId });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Déplacement impossible.");
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Déplacer ${node.name ?? ""}`} onClose={onClose}>
      <div className="m-form">
        <LocationPicker value={target} onChange={setTarget} emptyLabel="à choisir" />
        {error && <p className="error small">{error}</p>}
        <button type="button" disabled={busy || !target} onClick={() => target && move(target.id)}>
          Déplacer ici
        </button>
        {node.parent_id && (
          <button type="button" className="secondary" disabled={busy} onClick={() => move(null)}>
            Mettre à la racine
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Scan (ou saisie) d'une étiquette libre pour l'associer à un élément : lieu, contenant ou lot d'objet. */
export function LabelSheet({ node, onClose, onDone }: { node: { id: string }; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function onCode(raw: string) {
    setError(null);
    const code = normalizeCode(raw) ?? raw.trim().toUpperCase();
    try {
      await api.post(`/qr/labels/${code}/assign`, { node_id: node.id });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Association impossible.");
    }
  }

  return (
    <Sheet title="Associer une étiquette" onClose={onClose}>
      <Scanner onCode={onCode} hint="Scannez l'étiquette à coller sur cet élément" />
      {error && <p className="error small">{error}</p>}
    </Sheet>
  );
}

/** Inventaire d'une boîte : on corrige les quantités qui ne correspondent pas, le reste est validé tel quel. */
function CountSheet({
  title,
  items,
  names,
  onClose,
  onDone,
}: {
  title: string;
  items: Node[];
  names: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, String(Number(i.quantity ?? 0))])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    let fixed = 0;
    try {
      for (const item of items) {
        const wanted = Number(counts[item.id]);
        const current = Number(item.quantity ?? 0);
        if (!Number.isFinite(wanted) || wanted < 0) throw new ApiError(422, "invalid_quantity", "Quantité invalide.");
        if (wanted === current) continue;
        await api.post("/stock/movements", { node_id: item.id, kind: "adjust", delta: String(wanted - current), reason: "Inventaire" });
        fixed += 1;
      }
      notify(fixed ? `Inventaire enregistré : ${fixed} correction(s)` : "Inventaire : tout est conforme");
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Inventaire impossible.");
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Compter « ${title} »`} onClose={onClose}>
      <div className="m-form">
        <ul className="m-count">
          {items.map((i) => (
            <li key={i.id}>
              <span>{i.name ?? (i.article_id ? names[i.article_id] : null) ?? "Objet"}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={counts[i.id]}
                onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })}
                aria-label="Quantité comptée"
              />
            </li>
          ))}
        </ul>
        {error && <p className="error small">{error}</p>}
        <button type="button" disabled={busy} onClick={save}>
          Valider le comptage
        </button>
      </div>
    </Sheet>
  );
}
