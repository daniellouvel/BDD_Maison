import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/** En-tête fixe d'un écran mobile : retour, titre, sous-titre, action à droite. */
export function MHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string | null;
  /** Adresse de retour, ou -1 pour revenir à l'écran précédent. Absent : pas de bouton retour. */
  back?: string | -1;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="m-header">
      {back !== undefined && (
        <button
          type="button"
          className="m-icon"
          aria-label="Retour"
          onClick={() => (back === -1 ? navigate(-1) : navigate(back))}
        >
          ‹
        </button>
      )}
      <div className="m-header-text">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {action}
    </header>
  );
}

/** Feuille qui monte du bas de l'écran : formulaires et menus d'actions. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <strong>{title}</strong>
          <button type="button" className="secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Onglets en ligne (2 à 4 choix) : remplace le défilement par un changement de vue. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="m-seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Écran existant (interface classique) affiché dans la coque mobile, avec son en-tête. */
export function MPage({
  title,
  back = -1,
  keepTitle = false,
  children,
}: {
  title: string;
  back?: string | -1;
  /** Garde le titre de l'écran classique quand il dit autre chose que l'en-tête (ex. le code d'une étiquette). */
  keepTitle?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="m-view">
      <MHeader title={title} back={back} />
      <div className={`m-body m-pad${keepTitle ? "" : " m-notitle"}`}>{children}</div>
    </div>
  );
}
