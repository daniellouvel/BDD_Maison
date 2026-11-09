import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, fileUrl } from "../api";
import type { BoxCell, Node, NodeDetail } from "../types";

type Rect = { x: number; y: number; w: number; h: number };

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const place = (r: Rect): CSSProperties => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.w * 100}%`,
  height: `${r.h * 100}%`,
});

/** Plan d'une boîte : photo, cases tracées dessus (chacune = un élément enfant du contenant). */
export default function BoxPlan({
  node,
  contents,
  canWrite,
  onChanged,
}: {
  node: NodeDetail;
  contents: Node[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const photoId = node.layout?.photo_id ?? null;
  const cells = node.layout?.cells ?? [];
  const nameOf = (id: string) => contents.find((c) => c.id === id)?.name ?? "Case";

  function point(e: PointerEvent): { x: number; y: number } {
    const r = surface.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }

  async function saveLayout(photo: string | null, next: BoxCell[]) {
    await api.put(`/nodes/${node.id}/layout`, {
      version: node.version,
      photo_id: photo,
      cells: next.map((c) => ({ node_id: c.node_id, x: c.x, y: c.y, w: c.w, h: c.h })),
    });
    onChanged();
  }

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : message);
    } finally {
      setBusy(false);
    }
  }

  async function addCell(rect: Rect) {
    const name = window.prompt("Nom de la case (ex. A1, Vis M3, Résistances…)");
    if (!name?.trim()) return;
    await run(async () => {
      const child = await api.post<NodeDetail>("/nodes", {
        kind: "container",
        name: name.trim(),
        parent_id: node.id,
      });
      await saveLayout(photoId, [...cells, { node_id: child.id, ...rect }]);
    }, "Ajout de la case impossible.");
  }

  async function removeCell(cell: BoxCell) {
    if (!window.confirm(`Retirer la case « ${nameOf(cell.node_id)} » du plan ?`)) return;
    await run(async () => {
      await saveLayout(photoId, cells.filter((c) => c.node_id !== cell.node_id));
      try {
        await api.del(`/nodes/${cell.node_id}`);
      } catch (e) {
        // La case reste dans le contenant tant qu'elle a des objets : elle n'est plus sur le plan.
        setError(
          e instanceof ApiError
            ? `Case retirée du plan, mais non archivée : ${e.message}`
            : "Case retirée du plan, mais non archivée.",
        );
      }
    }, "Suppression impossible.");
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    await run(async () => {
      const form = new FormData();
      form.append("kind", "photo");
      form.append("node_id", node.id);
      form.append("title", file.name);
      form.append("file", file);
      const att = await api.post<{ id: string }>("/attachments", form);
      await saveLayout(att.id, cells);
    }, "Envoi de la photo impossible.");
  }

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (!editing || busy) return;
    origin.current = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ x: origin.current.x, y: origin.current.y, w: 0, h: 0 });
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const o = origin.current;
    if (!o) return;
    const p = point(e);
    setDraft({ x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) });
  }

  function onUp() {
    const rect = draft;
    origin.current = null;
    setDraft(null);
    if (rect && rect.w >= 0.03 && rect.h >= 0.03) void addCell(rect);
  }

  return (
    <section className="card">
      <h2>Plan de la boîte</h2>
      {!photoId ? (
        <>
          <p className="muted">Ajoutez une photo de l'intérieur pour y tracer les cases.</p>
          {canWrite && (
            <label className="filebutton">
              Ajouter la photo de la boîte
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => uploadPhoto(e.target.files?.[0])}
              />
            </label>
          )}
        </>
      ) : (
        <>
          <div
            ref={surface}
            className={`plan${editing ? " plan-editing" : ""}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            <img src={fileUrl(photoId)} alt="Intérieur de la boîte" draggable={false} />
            {cells.map((c) =>
              editing ? (
                <div key={c.node_id} className="plan-cell" style={place(c)}>
                  <span>{nameOf(c.node_id)}</span>
                </div>
              ) : (
                <Link key={c.node_id} to={`/nodes/${c.node_id}`} className="plan-cell" style={place(c)}>
                  <span>{nameOf(c.node_id)}</span>
                </Link>
              ),
            )}
            {draft && <div className="plan-cell plan-draft" style={place(draft)} />}
          </div>

          {canWrite && (
            <div className="row">
              <button type="button" className="secondary" onClick={() => setEditing(!editing)}>
                {editing ? "Terminer le tracé" : "Modifier le plan"}
              </button>
            </div>
          )}
          {editing && <p className="muted small">Glissez sur la photo pour tracer une case, puis donnez-lui un nom.</p>}
          {editing && cells.length > 0 && (
            <ul className="list">
              {cells.map((c) => (
                <li key={c.node_id}>
                  {nameOf(c.node_id)}{" "}
                  <button type="button" className="linklike danger" disabled={busy} onClick={() => removeCell(c)}>
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
