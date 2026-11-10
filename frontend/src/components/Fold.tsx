import { ReactNode, useEffect, useState } from "react";

const PHONE = "(max-width: 899px)";

/**
 * Section repliable sur téléphone seulement. Sur ordinateur, le contenu est toujours affiché
 * sans en-tête supplémentaire.
 */
export default function Fold({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const update = () => setPhone(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!phone) return <>{children}</>;
  return (
    <div className="fold">
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </div>
  );
}
