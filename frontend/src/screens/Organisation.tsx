import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import PlanView, { loadPlanNames } from "../components/PlanView";
import type { Node, NodeDetail, NodeKind } from "../types";

/**
 * Nouvelle vue « Organisation » : arbre dépliable à gauche, détail de l'élément choisi à droite.
 * Vue à côté de « Lieux », qui reste inchangée.
 */

const ICON: Record<NodeKind, string> = { location: "🏠", container: "📦", item: "🔩" };
const KIND_LABEL: Record<NodeKind, string> = { location: "Emplacement", container: "Contenant", item: "Objet" };

const labelOf = (n: Node, articles: Record<string, string>) =>
  n.name ?? (n.article_id ? articles[n.article_id] : null) ?? "Sans nom";

export default function Organisation() {
  const [roots, setRoots] = useState<Node[] | null>(null);
  const [articles, setArticles] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Node[]>("/nodes")
      .then(async (list) => {
        setRoots(list);
        await loadArticleNames(list, setArticles);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible."));
  }, []);

  // Les objets à la racine n'ont pas de place : on les met en avant.
  const unplaced = roots?.filter((n) => n.kind === "item" || n.kind === "container") ?? [];
  const placed = roots?.filter((n) => !unplaced.includes(n)) ?? [];

  return (
    <div className="organisation">
      <nav className="breadcrumb">
        <Link to="/">Accueil</Link> › <strong>Organisation</strong> ·{" "}
        <Link to="/nodes">ancienne vue « Lieux »</Link>
      </nav>
      {error && <p className="error">{error}</p>}

      <div className="org-layout">
        <aside className="org-tree card">
          {unplaced.length > 0 && (
            <>
              <h3 className="org-group">À ranger ({unplaced.length})</h3>
              <ul className="org-list">
                {unplaced.map((n) => (
                  <TreeRow
                    key={n.id}
                    node={n}
                    depth={0}
                    articles={articles}
                    selected={selected}
                    onSelect={setSelected}
                    setArticles={setArticles}
                  />
                ))}
              </ul>
            </>
          )}
          <h3 className="org-group">Emplacements</h3>
          {roots === null && <p className="muted">Chargement…</p>}
          <ul className="org-list">
            {placed.map((n) => (
              <TreeRow
                key={n.id}
                node={n}
                depth={0}
                articles={articles}
                selected={selected}
                onSelect={setSelected}
                setArticles={setArticles}
              />
            ))}
          </ul>
        </aside>

        <section className="org-detail card">
          {selected ? (
            <Detail id={selected} onSelect={setSelected} />
          ) : (
            <p className="muted">Choisissez un élément dans l'arbre.</p>
          )}
        </section>
      </div>
    </div>
  );
}

async function loadArticleNames(list: Node[], set: (f: (a: Record<string, string>) => Record<string, string>) => void) {
  const ids = [...new Set(list.filter((n) => !n.name && n.article_id).map((n) => n.article_id as string))];
  const found: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      const a = await api.get<{ name: string }>(`/articles/${id}`).catch(() => null);
      if (a) found[id] = a.name;
    }),
  );
  set((prev) => ({ ...prev, ...found }));
}

/** Une ligne de l'arbre : se déplie pour charger son contenu, se sélectionne pour voir le détail. */
function TreeRow({
  node,
  depth,
  articles,
  selected,
  onSelect,
  setArticles,
}: {
  node: Node;
  depth: number;
  articles: Record<string, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  setArticles: (f: (a: Record<string, string>) => Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<Node[] | null>(null);
  const expandable = node.kind !== "item";

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && kids === null) {
      const list = await api.get<Node[]>(`/nodes?parent_id=${node.id}`).catch(() => [] as Node[]);
      setKids(list);
      await loadArticleNames(list, setArticles);
    }
  }

  return (
    <li>
      <div
        className={`org-row${selected === node.id ? " org-selected" : ""}`}
        style={{ paddingLeft: `${depth * 1.1 + 0.4}rem` }}
      >
        <button
          type="button"
          className="org-caret"
          disabled={!expandable}
          onClick={toggle}
          aria-label={open ? "Replier" : "Déplier"}
        >
          {expandable ? (open ? "▾" : "▸") : ""}
        </button>
        <button type="button" className="org-name" onClick={() => onSelect(node.id)}>
          <span aria-hidden>{ICON[node.kind]}</span> {labelOf(node, articles)}
          {node.kind === "item" && node.quantity && (
            <span className="muted small"> × {formatQty(node.quantity, node.unit)}</span>
          )}
        </button>
      </div>
      {open && kids && kids.length > 0 && (
        <ul className="org-list">
          {kids.map((k) => (
            <TreeRow
              key={k.id}
              node={k}
              depth={depth + 1}
              articles={articles}
              selected={selected}
              onSelect={onSelect}
              setArticles={setArticles}
            />
          ))}
        </ul>
      )}
      {open && kids && kids.length === 0 && (
        <p className="muted small" style={{ paddingLeft: `${depth * 1.1 + 2}rem` }}>
          Vide
        </p>
      )}
    </li>
  );
}

/** Détail de l'élément choisi : chemin, contenu et actions. */
function Detail({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [kids, setKids] = useState<Node[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNode(null);
    setError(null);
    Promise.all([api.get<NodeDetail>(`/nodes/${id}`), api.get<Node[]>(`/nodes?parent_id=${id}`)])
      .then(async ([d, k]) => {
        setNode(d);
        setKids(k);
        if (d.layout?.levels?.length) setNames(await loadPlanNames(d.id, d.layout));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Chargement impossible."));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!node) return <p className="muted">Chargement…</p>;

  const path = node.breadcrumb.slice(0, -1).map((b) => b.name).join(" › ");
  const address = node.slug ?? node.id;
  const hasPlan = Boolean(node.layout?.levels?.length);
  const isBox = node.kind === "container" && hasPlan;

  return (
    <div className="detail-cards">
      <div className="detail-head">
        <div>
          {path && <p className="muted small">{path}</p>}
          <h2>
            {ICON[node.kind]} {node.name ?? node.article_name ?? "Sans nom"}
          </h2>
          <span className={`kind-chip kind-${node.kind}`}>{KIND_LABEL[node.kind]}</span>
          {node.kind === "item" && node.quantity && (
            <span className="muted"> · {formatQty(node.quantity, node.unit)}</span>
          )}
          {node.qr_code && <span className="ribbon">{node.qr_code}</span>}
        </div>
        <div className="detail-actions">
          <Link className="button" to={`/nodes/${address}`}>
            Ouvrir la fiche
          </Link>
          <Link className="button secondary" to={`/nodes/${address}`}>
            Déplacer
          </Link>
        </div>
      </div>

      {node.kind !== "item" && (
        <section className="detail-card">
          <h3>Contenu ({kids.length})</h3>
          {kids.length === 0 ? (
            <p className="muted small">Vide. Ajoutez-y un objet depuis la fiche.</p>
          ) : (
            <div className="content-grid">
              {kids.map((k) => (
                <button key={k.id} type="button" className="content-card" onClick={() => onSelect(k.id)}>
                  <span aria-hidden>{ICON[k.kind]}</span>
                  <strong>{k.name ?? "Sans nom"}</strong>
                  <small className="muted">{KIND_LABEL[k.kind]}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {hasPlan && node.layout && (
        <section className="detail-card">
          <h3>Plan {isBox ? "de la boîte" : ""}</h3>
          <PlanView layout={node.layout} names={names} onCellClick={onSelect} />
        </section>
      )}

      <section className="detail-card">
        <h3>Infos</h3>
        <dl className="attrs">
          <div>
            <dt>Chemin</dt>
            <dd>{node.breadcrumb.map((b) => b.name).join(" › ")}</dd>
          </div>
          <div>
            <dt>Étiquette</dt>
            <dd>{node.qr_code ?? "aucune"}</dd>
          </div>
          {node.kind === "item" && node.article_name && (
            <div>
              <dt>Article</dt>
              <dd>{node.article_name}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
