import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import PhoneActions from "../components/PhoneActions";
import PlanPreview from "../components/PlanPreview";
import LabelField from "../components/LabelField";
import ArticleDetailScreen from "./ArticleDetail";
import { fetchLabel, normalizeCode } from "../qr";
import Scanner from "../components/Scanner";
import type { Node, NodeDetail, NodeKind, SearchHit } from "../types";

/**
 * Étape 1 : accueil = arbre des emplacements (à gauche), détail de l'élément choisi (à droite),
 * recherche en haut. Les actions Ajouter, Déplacer et Supprimer sont sur le détail.
 */

const ICON: Record<NodeKind, string> = { location: "🏠", container: "📦", item: "🔩" };
const KIND_LABEL: Record<NodeKind, string> = { location: "Emplacement", container: "Contenant", item: "Objet" };

type Names = Record<string, string>;

export default function Home() {
  const { canWrite, logout, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get("n");
  const select = useCallback((id: string) => setParams({ n: id }), [setParams]);
  const [rootAdd, setRootAdd] = useState(false);
  const [moving, setMoving] = useState<Moving | null>(null);
  // Incrémenté à chaque changement de l'arbre : il se recharge alors.
  const [treeKey, setTreeKey] = useState(0);
  const changed = () => setTreeKey((k) => k + 1);

  return (
    <div className="explorer">
      <div className="explorer-top">
        <Search onPick={select} />
        <span className="muted small">
          {user.username} · <button type="button" className="linklike" onClick={logout}>Se déconnecter</button>
        </span>
      </div>
      <div className="explorer-body">
        <aside className="explorer-tree card">
          {canWrite && (
            <button type="button" className="root-add" onClick={() => setRootAdd(!rootAdd)}>
              {rootAdd ? "Fermer" : "+ Ajouter à la racine"}
            </button>
          )}
          {moving && (
            <MoveBanner
              moving={moving}
              onCancel={() => setMoving(null)}
              onMoved={(movedId) => {
                setMoving(null);
                changed();
                select(movedId);
              }}
            />
          )}
          {rootAdd && (
            <AddPanel
              parent={null}
              onDone={(created) => {
                setRootAdd(false);
                changed();
                if (created) select(created);
              }}
            />
          )}
          <Tree key={treeKey} selected={selected} onSelect={select} />
        </aside>
        <section className="explorer-detail card">
          {selected ? (
            <Detail
              id={selected}
              onSelect={select}
              canWrite={canWrite}
              moving={moving}
              onChanged={changed}
              onStartMove={setMoving}
              onCancelMove={() => setMoving(null)}
              onMoved={(movedId) => {
                changed();
                setMoving(null);
                select(movedId);
              }}
            />
          ) : (
            <p className="muted">Choisissez un élément dans l'arbre, ou cherchez-en un en haut.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- Recherche ---------- */

function Search({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setError(null);
    try {
      setHits(await api.get<SearchHit[]>(`/search?q=${encodeURIComponent(q.trim())}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Recherche impossible.");
    }
  }

  return (
    <div className="explorer-search">
      <form onSubmit={submit} className="searchbar">
        <input type="search" placeholder="Rechercher un objet…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">Chercher</button>
      </form>
      {error && <p className="error small">{error}</p>}
      {hits && (
        <div className="search-results card">
          {hits.length === 0 && <p className="muted small">Aucun résultat pour « {q} ».</p>}
          {hits.map((h) => (
            <div key={h.article.id} className="search-hit">
              <strong>{h.article.name}</strong>{" "}
              <span className="muted small">× {formatQty(h.total_quantity)}</span>
              {h.locations.length === 0 && <p className="muted small">Non rangé</p>}
              {h.locations.map((loc) => (
                <button
                  key={loc.node_id}
                  type="button"
                  className="linklike small"
                  onClick={() => {
                    onPick(loc.node_id);
                    setHits(null);
                  }}
                >
                  {loc.path.join(" › ")} × {formatQty(loc.quantity)}
                </button>
              ))}
            </div>
          ))}
          <button type="button" className="linklike small" onClick={() => setHits(null)}>
            Fermer
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Arbre ---------- */

function Tree({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [roots, setRoots] = useState<Node[] | null>(null);
  const [names, setNames] = useState<Names>({});
  const [error, setError] = useState<string | null>(null);
  // Ancêtres de l'élément sélectionné (de la racine à lui) : leurs branches s'ouvrent seules.
  const [path, setPath] = useState<string[]>([]);

  useEffect(() => {
    if (!selected) return setPath([]);
    api
      .get<NodeDetail>(`/nodes/${selected}`)
      .then((d) => setPath(d.breadcrumb.map((b) => b.id)))
      .catch(() => setPath([]));
  }, [selected]);

  const load = useCallback(() => {
    api
      .get<Node[]>("/nodes")
      .then(async (list) => {
        setRoots(list);
        const found = await articleNames(list, {});
        setNames((prev) => ({ ...prev, ...found }));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unplaced = roots?.filter((n) => n.kind !== "location") ?? [];
  const placed = roots?.filter((n) => n.kind === "location") ?? [];

  return (
    <>
      {error && <p className="error small">{error}</p>}
      {roots === null && <p className="muted small">Chargement…</p>}
      {unplaced.length > 0 && (
        <>
          <p className="org-group">À ranger ({unplaced.length})</p>
          <ul className="org-list">
            {unplaced.map((n) => (
              <TreeRow key={n.id} node={n} depth={0} names={names} selected={selected} path={path} onSelect={onSelect} setNames={setNames} />
            ))}
          </ul>
        </>
      )}
      <p className="org-group">Emplacements</p>
      <ul className="org-list">
        {placed.map((n) => (
          <TreeRow key={n.id} node={n} depth={0} names={names} selected={selected} path={path} onSelect={onSelect} setNames={setNames} />
        ))}
      </ul>
    </>
  );
}

function TreeRow({
  node,
  depth,
  names,
  selected,
  path,
  onSelect,
  setNames,
}: {
  node: Node;
  depth: number;
  names: Names;
  selected: string | null;
  path: string[];
  onSelect: (id: string) => void;
  setNames: (f: (n: Names) => Names) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<Node[] | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const expandable = node.kind !== "item";
  const label = node.name ?? (node.article_id ? names[node.article_id] : null) ?? "Sans nom";
  const isSelected = selected === node.id;
  const onPath = path.includes(node.id) && !isSelected;

  async function openNode(next: boolean) {
    setOpen(next);
    if (next && kids === null) {
      const list = await api.get<Node[]>(`/nodes?parent_id=${node.id}`).catch(() => [] as Node[]);
      setKids(list);
      const found = await articleNames(list, {});
      setNames((prev) => ({ ...prev, ...found }));
    }
  }

  // Un ancêtre de l'élément sélectionné s'ouvre tout seul : on voit où il est rangé.
  useEffect(() => {
    if (onPath && expandable && !open) void openNode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPath]);

  // La ligne sélectionnée reste visible dans l'arbre défilant.
  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  return (
    <li>
      <div ref={rowRef} className={`org-row${isSelected ? " org-selected" : ""}`}>
        <button type="button" className="org-caret" disabled={!expandable} onClick={() => openNode(!open)} aria-label="Déplier">
          {expandable ? (open ? "▾" : "▸") : ""}
        </button>
        <button type="button" className="org-name" onClick={() => onSelect(node.id)}>
          <span aria-hidden>{ICON[node.kind]}</span> {label}
          {node.kind === "item" && node.quantity && <span className="muted small"> × {formatQty(node.quantity, node.unit)}</span>}
        </button>
      </div>
      {open && kids && kids.length > 0 && (
        <ul className="org-list">
          {kids.map((k) => (
            <TreeRow key={k.id} node={k} depth={depth + 1} names={names} selected={selected} path={path} onSelect={onSelect} setNames={setNames} />
          ))}
        </ul>
      )}
      {open && kids && kids.length === 0 && <p className="muted small org-empty">Vide</p>}
    </li>
  );
}

async function articleNames(list: Node[], known: Names): Promise<Names> {
  const ids = [...new Set(list.filter((n) => !n.name && n.article_id && !known[n.article_id]).map((n) => n.article_id as string))];
  const found: Names = {};
  await Promise.all(
    ids.map(async (id) => {
      const a = await api.get<{ name: string }>(`/articles/${id}`).catch(() => null);
      if (a) found[id] = a.name;
    }),
  );
  return found;
}

/* ---------- Détail et actions ---------- */

type Panel = "none" | "add" | "edit";

type Moving = { id: string; name: string; version: number };

function Detail({
  id,
  onSelect,
  canWrite,
  moving,
  onStartMove,
  onCancelMove,
  onMoved,
  onChanged,
}: {
  id: string;
  onSelect: (id: string) => void;
  canWrite: boolean;
  moving: Moving | null;
  onStartMove: (m: Moving) => void;
  onCancelMove: () => void;
  onMoved: (id: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function confirmMove(target: NodeDetail) {
    if (!moving) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/nodes/${moving.id}`, { version: moving.version, parent_id: target.id });
      onMoved(moving.id);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Déplacement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const [node, setNode] = useState<NodeDetail | null>(null);
  const [kids, setKids] = useState<Node[]>([]);
  const [kidNames, setKidNames] = useState<Names>({});
  const [panel, setPanel] = useState<Panel>("none");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    // `id` peut être un slug (adresse lisible) : les enfants se cherchent par l'identifiant réel.
    api
      .get<NodeDetail>(`/nodes/${id}`)
      .then(async (d) => {
        const k = await api.get<Node[]>(`/nodes?parent_id=${d.id}`);
        setNode(d);
        setKids(k);
        // Un objet porte le nom de son article : on le charge pour l'afficher dans la liste.
        const found = await articleNames(k, {});
        setKidNames((prev) => ({ ...prev, ...found }));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible."));
  }, [id]);

  useEffect(() => {
    setPanel("none");
    setNode(null);
    load();
  }, [id, load]);

  async function remove() {
    if (!node) return;
    const label = node.name ?? node.article_name ?? "cet élément";
    const warning =
      "Tout ce qui est dedans sera supprimé (étages, cases, contenants, objets).\n" +
      "Rien n'est effacé définitivement, mais ces éléments ne figureront plus dans l'inventaire.";
    if (!window.confirm(`Supprimer « ${label} » ?\n\n${warning}`)) return;
    const done = () => {
      onChanged();
      onSelect(node.parent_id ?? "");
    };
    try {
      await api.post(`/nodes/${node.id}/archive-tree`, {});
      done();
    } catch (e) {
      if (e instanceof ApiError && e.code === "stock_remaining") {
        // Il reste du stock : on propose de le retirer avec l'élément (l'historique en garde la trace).
        const again = window.confirm(
          `${e.message}\n\nSupprimer aussi ce stock ? Il sera sorti du stock (mouvement « Suppression de l'objet »).`,
        );
        if (!again) return;
        try {
          await api.post(`/nodes/${node.id}/archive-tree?remove_stock=true`, {});
          done();
        } catch (e2) {
          setError(e2 instanceof ApiError ? e2.message : "Suppression impossible.");
        }
        return;
      }
      setError(e instanceof ApiError ? e.message : "Suppression impossible.");
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!node) return <p className="muted">Chargement…</p>;

  const path = node.breadcrumb.map((b) => b.name).join(" › ");
  const canHaveChildren = node.kind !== "item";

  return (
    <>
      <p className="muted small path-line">
        {node.breadcrumb.map((b, i) => (
          <span key={b.id}>
            {i > 0 && " › "}
            {i < node.breadcrumb.length - 1 ? (
              <button type="button" className="linklike" onClick={() => onSelect(b.id)}>
                {b.name}
              </button>
            ) : (
              b.name
            )}
          </span>
        ))}
      </p>
      <h2>
        {ICON[node.kind]} {node.name ?? node.article_name ?? "Sans nom"}
      </h2>
      <p className="muted">
        {KIND_LABEL[node.kind]}
        {node.kind === "item" && node.quantity ? ` · ${formatQty(node.quantity, node.unit)}` : ""}
        {node.qr_code ? ` · étiquette ${node.qr_code}` : ""}
      </p>

      {moving && moving.id === node.id && (
        <div className="move-target card">
          <strong>C'est l'élément à déplacer.</strong>
          <p className="muted small">Cliquez sur sa nouvelle destination dans l'arbre à gauche.</p>
        </div>
      )}
      {moving && moving.id !== node.id && (
        <div className="move-target card">
          {canHaveChildren ? (
            <>
              <p>
                Destination : <strong>{path || "Racine"}</strong>
              </p>
              <div className="row">
                <button type="button" onClick={() => confirmMove(node)} disabled={busy}>
                  Déplacer « {moving.name} » ici
                </button>
                <button type="button" className="secondary" onClick={onCancelMove}>
                  Annuler
                </button>
              </div>
            </>
          ) : (
            <p className="muted small">Un objet ne peut pas contenir d'autres éléments : choisissez un emplacement ou un contenant.</p>
          )}
        </div>
      )}

      {canWrite && !moving && (
        <div className="row">
          {canHaveChildren && (
            <button type="button" onClick={() => setPanel(panel === "add" ? "none" : "add")}>
              Ajouter ici
            </button>
          )}
          {canHaveChildren && (
            <button type="button" className="secondary" onClick={() => navigate(`/ranger?to=${node.id}`)}>
              Ranger ici
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => onStartMove({ id: node.id, name: node.name ?? node.article_name ?? "élément", version: node.version })}
          >
            Déplacer
          </button>
          <button type="button" className="secondary" onClick={() => setPanel(panel === "edit" ? "none" : "edit")}>
            Modifier
          </button>
          <button type="button" className="secondary danger" onClick={remove}>
            Supprimer
          </button>
        </div>
      )}

      {panel === "edit" && node && (
        <EditPanel
          node={node}
          onDone={() => {
            setPanel("none");
            load();
            onChanged();
          }}
          onCancel={() => setPanel("none")}
        />
      )}
      {panel === "add" && node && (
        <AddPanel
          parent={node}
          onDone={(created) => {
            setPanel("none");
            load();
            onChanged();
            if (created) onSelect(created);
          }}
        />
      )}

      {node && !moving && (
        <PhoneActions
          node={node}
          onStartMove={() => onStartMove({ id: node.id, name: node.name ?? node.article_name ?? "élément", version: node.version })}
          onDone={() => {
            load();
            onChanged();
          }}
        />
      )}

      {node.kind === "item" && node.article_id && !moving && (
        <div className="article-sheet">
          {/* Fiche complète de l'article : infos, catégorie, champs, photos, documents, liens. */}
          <ArticleDetailScreen articleId={node.article_id} />
        </div>
      )}

      {canHaveChildren && <PlanPreview key={node.id} node={node} canWrite={canWrite} onChanged={load} />}
      {canHaveChildren && (
        <section className="detail-card">
          <h3>Contenu ({kids.length})</h3>
          {kids.length === 0 && <p className="muted small">Vide.</p>}
          <ul className="list">
            {kids.map((k) => (
              <li key={k.id}>
                <button type="button" className="linklike" onClick={() => onSelect(k.id)}>
                  {ICON[k.kind]} {k.name ?? (k.article_id ? kidNames[k.article_id] : null) ?? "Objet"}
                </button>
                {k.kind === "item" && k.quantity && <span className="muted small"> × {formatQty(k.quantity, k.unit)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Ajouter ici : un emplacement, un contenant, ou un objet (avec sa quantité). */
function AddPanel({ parent, onDone }: { parent: NodeDetail | null; onDone: (createdId: string | null) => void }) {
  const [kind, setKind] = useState<"location" | "container" | "item">(parent ? "container" : "location");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [labelCode, setLabelCode] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!createdId && !name.trim()) return setError("Donnez un nom.");
    setBusy(true);
    setError(null);
    let id = createdId;
    try {
      if (!id) {
        if (kind === "item") {
          const article = await api.post<{ id: string }>("/articles", { name: name.trim() });
          const item = await api.post<{ id: string }>("/nodes", {
            kind: "item",
            parent_id: parent?.id ?? null,
            article_id: article.id,
            quantity: quantity || "1",
            unit: unit || null,
          });
          id = item.id;
        } else {
          const created = await api.post<{ id: string }>("/nodes", { kind, name: name.trim(), parent_id: parent?.id ?? null });
          id = created.id;
        }
        setCreatedId(id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ajout impossible.");
      setBusy(false);
      return;
    }
    // L'élément est créé : l'étiquette est associée ensuite, et réessayable sans le recréer.
    if (labelCode.trim()) {
      try {
        await api.post(`/qr/labels/${normalizeCode(labelCode) ?? labelCode.trim()}/assign`, { node_id: id });
      } catch (err) {
        setError(`Créé, mais l'étiquette n'a pas pu être associée : ${err instanceof ApiError ? err.message : "erreur"}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onDone(id);
  }

  return (
    <form className="form detail-card" onSubmit={submit}>
      <h3>{parent ? `Ajouter dans « ${parent.name ?? parent.article_name} »` : "Ajouter à la racine"}</h3>
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        <option value="container">Contenant (tiroir, boîte, casier…)</option>
        <option value="location">Emplacement (meuble, zone…)</option>
        <option value="item">Objet</option>
      </select>
      <input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {kind === "item" && (
        <div className="row">
          <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantité" />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unité (pcs, g…)" />
        </div>
      )}
      <LabelField value={labelCode} onChange={setLabelCode} />
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {createdId ? "Réessayer l'étiquette" : "Ajouter"}
        </button>
        <button type="button" className="secondary" onClick={() => onDone(createdId)}>
          {createdId ? "Terminer" : "Annuler"}
        </button>
      </div>
    </form>
  );
}


/** Modifier : nom, notes, et unité pour un objet. La quantité se change par les mouvements de stock. */
function EditPanel({ node, onDone, onCancel }: { node: NodeDetail; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(node.name ?? "");
  const [notes, setNotes] = useState(node.notes ?? "");
  const [unit, setUnit] = useState(node.unit ?? "");
  const [labelCode, setLabelCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (node.kind !== "item" && !name.trim()) return setError("Donnez un nom.");
    setBusy(true);
    setError(null);
    try {
      // L'étiquette d'abord : si le code est refusé, rien d'autre n'est modifié.
      if (labelCode.trim()) {
        await api.post(`/qr/labels/${normalizeCode(labelCode) ?? labelCode.trim()}/assign`, { node_id: node.id });
        setLabelCode("");
      }
      const body: Record<string, unknown> = { version: node.version, notes: notes.trim() || null };
      if (node.kind !== "item") body.name = name.trim();
      else {
        body.unit = unit.trim() || null;
        if (name.trim()) body.name = name.trim();
      }
      await api.patch(`/nodes/${node.id}`, body);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Modification impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form detail-card" onSubmit={submit}>
      <h3>Modifier</h3>
      <input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} />
      {node.kind === "item" && <input placeholder="Unité (pcs, g, m…)" value={unit} onChange={(e) => setUnit(e.target.value)} />}
      <textarea placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {node.qr_code ? (
        <p className="muted small">
          Étiquette : <strong>{node.qr_code}</strong>
        </p>
      ) : (
        <LabelField value={labelCode} onChange={setLabelCode} />
      )}
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>
          Enregistrer
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/**
 * Bandeau du déplacement : la destination se choisit dans l'arbre, ou en scannant son étiquette.
 */
function MoveBanner({
  moving,
  onCancel,
  onMoved,
}: {
  moving: Moving;
  onCancel: () => void;
  onMoved: (movedId: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Destination scannée, en attente de confirmation : évite de déplacer sur une mauvaise étiquette.
  const [pending, setPending] = useState<NodeDetail | null>(null);

  // Déplace l'objet vers la destination (même règle que le bouton « Déplacer ici »).
  async function moveTo(target: NodeDetail) {
    if (target.kind === "item") {
      setError("Un objet ne peut pas contenir d'autres éléments : scannez un emplacement ou un contenant.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/nodes/${moving.id}`, { version: moving.version, parent_id: target.id });
      setScanning(false);
      onMoved(moving.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Déplacement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onCode(text: string) {
    setError(null);
    const code = normalizeCode(text);
    if (!code) return setError("Ce n'est pas une étiquette QR.");
    try {
      const label = await fetchLabel(code);
      if (label.status !== "assigned" || !label.node) {
        return setError(`${code} n'est affectée à aucun emplacement.`);
      }
      setPending(label.node);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lecture impossible.");
    }
  }

  return (
    <div className="move-inline">
      <div className="row">
        <button type="button" onClick={() => setScanning(!scanning)}>
          {scanning ? "Fermer le scan" : "Scanner"}
        </button>
        <button type="button" className="secondary" onClick={onCancel} aria-label="Annuler le déplacement">
          ✕
        </button>
      </div>
      {scanning && <Scanner onCode={onCode} hint={busy ? "Déplacement…" : "Scannez l'étiquette de la destination"} />}
      {pending && (
        <div className="move-confirm">
          <p>Déplacer « {moving.name} » vers <strong>{pending.breadcrumb.map((b) => b.name).join(" › ")}</strong> ?</p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => moveTo(pending)}>
              Confirmer
            </button>
            <button type="button" className="secondary" onClick={() => setPending(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
