import { Link } from "react-router-dom";
import { thumbUrl } from "../api";
import type { Article, SimilarHit } from "../types";

/** Liste d'articles ressemblants avec la photo qui ressemble. `onPick` remplace le lien. */
export default function SimilarList({
  hits,
  onPick,
  pickLabel,
}: {
  hits: SimilarHit[];
  onPick?: (article: Article) => void;
  pickLabel?: string;
}) {
  return (
    <ul className="similar">
      {hits.map((h) => (
        <li key={h.article.id}>
          <img src={thumbUrl(h.attachment_id)} alt="" loading="lazy" />
          <span>
            {onPick ? (
              <button type="button" className="linklike" onClick={() => onPick(h.article)}>
                {pickLabel ? `${pickLabel} « ${h.article.name} »` : h.article.name}
              </button>
            ) : (
              <Link to={`/articles/${h.article.id}`}>{h.article.name}</Link>
            )}
            <span className="muted small"> · ressemblance {Math.round(h.score * 100)} %</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
