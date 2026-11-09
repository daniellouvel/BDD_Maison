import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, formatQty } from "../api";
import { useAuth } from "../auth";
import LabelPicker from "../components/LabelPicker";
import LocationPicker from "../components/LocationPicker";
import MovementForm from "../components/MovementForm";
import Scanner from "../components/Scanner";
import type { Node, NodeDetail, NodeKind, NodeType } from "../types";

const KIND_LABEL: Record<NodeKind, string> = {
  location: "Emplacement",
  container: "Contenant",
  item: "Objet",
};

export default function Nodes() {
  const { id } = useParams();
  const { canWrite } = useAuth();
  const navigate = useNavigate();
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [children, setChildren] = useState<Node[]>([]);
  const [types, setTypes] = useState<NodeType[]>([]);
  const [articleNames, setArticleNames] = useState<Record<string, string>>({});
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, kids, nodeTypes] = await Promise.all([
        id ? api.get<NodeDetail>(`/nodes/${id}`) : Promise.resolve(null),
        api.get<Node[]>(id ? `/nodes?parent_id=${id}` : "/nodes"),
        api.get<NodeType[]>("/node-types"),
      ]);
      setNode(detail);
      setChildren(kids);
      setTypes(nodeTypes);
      // Les objets sans nom affichent le nom de leur article.
      const missing = [...new Set(kids.filter((k) => !k.name && k.article_id).map((k) => k.article_id!))];
      const names: Record<string, string> = {};
      await Promise.all(
        missing.map(async (aid) => {
          const a = await api.get<{ name: string }>(`/articles/${aid}`);
          names[aid] = a.name;
        }),
      );
      setArticleNames(names);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Chargement impossible.");
    }
  }, [id]);

  useEffect(() => {
    setAttaching(false);
    load();
  }, [load]);

  async function archive() {
    if (!node || !window.confirm("Archiver cet élément ? Il n'apparaîtra plus dans l'inventaire.")) return;
    try {
      await api.del(`/nodes/${node.id}`);
      navigate(node.parent_id ? `/nodes/${node.parent_id}` : "/nodes");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Archivage impossible.");
    }
  }

  const typeName = (tid: string | null) => types.find((t) => t.id === tid)?.name;

  return (
    <>
      <nav className="breadcrumb">
        <Link to="/nodes">Racine</Link>
        {node?.breadcrumb.map((b) => (
          <span key={b.id}>
            {" › "}
            {b.id === node.id ? <strong>{b.name}</strong> : <Link to={`/nodes/${b.id}`}>{b.name}</Link>}
          </span>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}

      {node && (
        <section className="card">
          <h1>{node.name ?? node.article_name ?? "Sans nom"}</h1>
          <p className="muted">
            {KIND_LABEL[node.kind]}
            {typeName(node.node_type_id) ? ` · ${typeName(node.node_type_id)}` : ""}
          </p>
          {node.kind === "item" && (
            <>
              <p>
                Quantité : <strong>{formatQty(node.quantity, node.unit)}</strong>
                {node.article_id && (
                  <>
                    {" · "}
                    <Link to={`/articles/${node.article_id}`}>Fiche de l'article</Link>
                  </>
                )}
              </p>
              {canWrite && <MovementForm nodeId={node.id} onDone={load} />}
            </>
          )}
          {node.notes && <p>{node.notes}</p>}
          <p>
            {node.qr_code ? (
              <>
                Étiquette : <Link to={`/qr/labels/${node.qr_code}`}>{node.qr_code}</Link>
              </>
            ) : (
              <span className="muted">Pas d'étiquette QR</span>
            )}
          </p>
          {canWrite && (
            <div className="row">
              <Link className="button secondary" to={`/scan?mode=move&source=${node.id}`}>
                Déplacer (scanner la destination)
              </Link>
              {!node.qr_code && (
                <button type="button" className="secondary" onClick={() => setAttaching(!attaching)}>
                  Associer une étiquette
                </button>
              )}
            </div>
          )}
          {canWrite && node.kind === "item" && node.parent_id === null && (
            <LocateItem node={node} onDone={load} />
          )}
          {attaching && (
            <AttachLabel
              nodeId={node.id}
              onDone={() => {
                setAttaching(false);
                load();
              }}
            />
          )}
          {canWrite && (
            <button type="button" className="linklike danger" onClick={archive}>
              Archiver
            </button>
          )}
        </section>
      )}

      {node?.kind !== "item" && (
        <>
          <section className="card">
            <h2>{node ? "Contenu" : "Emplacements principaux"}</h2>
            {children.length === 0 && <p className="muted">Vide.</p>}
            <ul className="list">
              {children.map((c) => (
                <li key={c.id}>
                  <span className={`kind kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>{" "}
                  <Link to={`/nodes/${c.id}`}>{c.name ?? (c.article_id ? articleNames[c.article_id] : null) ?? "Sans nom"}</Link>
                  {c.kind === "item" && <span className="muted"> × {formatQty(c.quantity, c.unit)}</span>}
                </li>
              ))}
            </ul>
          </section>
          {canWrite && (
            <section className="card">
              {node && (
                <p>
                  <Link to={`/articles/new?parent=${node.id}`}>+ Ajouter un objet ici</Link>
                </p>
              )}
              {/* key : réinitialise le formulaire (type par défaut) à chaque changement d'emplacement */}
              <NewChild key={node?.id ?? "root"} parentId={node?.id ?? null} types={types} onCreated={load} />
            </section>
          )}
        </>
      )}
    </>
  );
}

function AttachLabel({ nodeId, onDone }: { nodeId: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function onCode(code: string) {
    setError(null);
    try {
      await api.post(`/qr/labels/${code}/assign`, { node_id: nodeId });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Affectation impossible.");
    }
  }

  return (
    <>
      <Scanner onCode={onCode} hint="Scannez une étiquette vierge à coller sur cet élément" />
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** Objet sans emplacement : choisir où le ranger (scan, code ou parcours), puis l'enregistrer. */
function LocateItem({ node, onDone }: { node: NodeDetail; onDone: () => void }) {
  const [chosen, setChosen] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/nodes/${node.id}`, { version: node.version, parent_id: chosen.id });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Localiser cet objet</h2>
      <LocationPicker value={chosen} onChange={setChosen} />
      {chosen && (
        <button type="button" onClick={save} disabled={busy}>
          Enregistrer l'emplacement
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function NewChild({
  parentId,
  types,
  onCreated,
}: {
  parentId: string | null;
  types: NodeType[];
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<"location" | "container">(parentId ? "container" : "location");
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [labelCode, setLabelCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addType() {
    const typeName = window.prompt("Nom du nouveau type (ex. Tiroir, Boîte, Meuble)");
    if (!typeName?.trim()) return;
    try {
      const created = await api.post<NodeType>("/node-types", { name: typeName.trim() });
      setTypeId(created.id);
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Création impossible.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.post<{ id: string }>("/nodes", {
        kind,
        name: name.trim(),
        parent_id: parentId,
        node_type_id: typeId || null,
      });
      setName("");
      if (labelCode) {
        try {
          await api.post(`/qr/labels/${labelCode}/assign`, { node_id: created.id });
          setLabelCode(null);
        } catch (err) {
          setError(
            `Créé, mais l'étiquette n'a pas pu être associée : ${err instanceof ApiError ? err.message : "erreur"}`,
          );
        }
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2>Créer ici</h2>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="location">Emplacement (pièce, zone, meuble…)</option>
          <option value="container">Contenant (tiroir, boîte…)</option>
        </select>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Type —</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={addType}>
          + type
        </button>
      </div>
      <input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} required />
      <LabelPicker value={labelCode} onChange={setLabelCode} />
      {error && <p className="error">{error}</p>}
      <button type="submit">Créer</button>
    </form>
  );
}
