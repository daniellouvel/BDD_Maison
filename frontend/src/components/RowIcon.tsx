import { thumbUrl } from "../api";

/** Vignette d'un objet quand il a une photo, sinon l'icône habituelle. */
export default function RowIcon({ photoId, fallback }: { photoId?: string | null; fallback: string }) {
  if (!photoId) return <span className="ic">{fallback}</span>;
  return <img className="ic ic-photo" src={thumbUrl(photoId)} alt="" loading="lazy" />;
}
