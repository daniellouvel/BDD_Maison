import { useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import Achats from "../screens/Achats";
import Categories from "../screens/Categories";
import Fournisseurs from "../screens/Fournisseurs";
import LabelDetail from "../screens/LabelDetail";
import PlanEditor from "../screens/PlanEditor";
import PlanModelEditor from "../screens/PlanModelEditor";
import Plans from "../screens/Plans";
import Prets from "../screens/Prets";
import QrManager from "../screens/QrManager";
import Ranger from "../screens/Ranger";
import Scan from "../screens/Scan";
import Settings from "../screens/Settings";
import MArticle from "./MArticle";
import MHome, { MLowStock } from "./MHome";
import MNode from "./MNode";
import MShopping from "./MShopping";
import { readTextSize, applyTextSize, type TextSize } from "../textSize";
import { MHeader, MPage } from "./ui";
import "./mobile.css";

/** Anciennes adresses d'éléments (/nodes/:id, QR) : on ouvre l'élément dans l'interface mobile. */
function NodeRedirect() {
  const { id } = useParams();
  return <Navigate to={`/e/${encodeURIComponent(id ?? "")}`} replace />;
}

/**
 * Interface pensée pour le téléphone : l'application tient dans l'écran, sans défilement de page.
 * Cinq onglets en bas, Scanner au centre. Les écrans rarement utilisés sur téléphone (plans,
 * étiquettes, catégories…) reprennent ceux de l'interface classique, rangés dans « Plus ».
 */
export default function MobileApp({ statusLabel, onClassic }: { statusLabel: string | null; onClassic: () => void }) {
  return (
    <div className="m-app">
      {statusLabel && <div className="m-offline">{statusLabel}</div>}
      <div className="m-screen">
        <Routes>
          <Route path="/" element={<MHome statusLabel={null} />} />
          <Route path="/lieux" element={<MNode />} />
          <Route path="/e/:id" element={<MNode />} />
          <Route path="/a/:id" element={<MArticle />} />
          <Route path="/achats" element={<MShopping />} />
          <Route path="/plus" element={<MMore onClassic={onClassic} />} />
          <Route path="/stock-bas" element={<MPage title="Stock bas" back="/"><MLowStock /></MPage>} />

          {/* Écrans de l'interface classique, affichés dans la coque mobile. */}
          <Route path="/scan" element={<MPage title="Scanner" back="/"><Scan /></MPage>} />
          <Route path="/ranger" element={<MPage title="Ranger"><Ranger /></MPage>} />
          <Route path="/achats/prix" element={<MPage title="Prix et fournisseurs" back="/achats"><Achats /></MPage>} />
          <Route path="/prets" element={<MPage title="Prêts"><Prets /></MPage>} />
          <Route path="/fournisseurs" element={<MPage title="Fournisseurs" back="/plus"><Fournisseurs /></MPage>} />
          <Route path="/categories" element={<MPage title="Catégories" back="/plus"><Categories /></MPage>} />
          <Route path="/plans" element={<MPage title="Plans" back="/plus"><Plans /></MPage>} />
          <Route path="/plans/:id" element={<MPage title="Modèle de plan" back="/plans" keepTitle><PlanModelEditor /></MPage>} />
          <Route path="/plan/:id" element={<MPage title="Plan" keepTitle><PlanEditor /></MPage>} />
          <Route path="/qr" element={<MPage title="Étiquettes QR" back="/plus"><QrManager /></MPage>} />
          <Route path="/qr/labels/:code" element={<MPage title="Étiquette" keepTitle><LabelDetail /></MPage>} />
          <Route path="/l/:code" element={<MPage title="Étiquette" back="/" keepTitle><LabelDetail redirectAssigned /></MPage>} />
          <Route path="/reglages" element={<MPage title="Réglages" back="/plus"><Settings /></MPage>} />
          <Route path="/nodes/:id" element={<NodeRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      <nav className="m-tabs" aria-label="Navigation">
        <NavLink to="/" end>
          <span className="ic">⌂</span>Accueil
        </NavLink>
        <NavLink to="/lieux">
          <span className="ic">▤</span>Lieux
        </NavLink>
        <NavLink to="/scan" className="m-scan">
          <span className="ic">⛶</span>Scanner
        </NavLink>
        <NavLink to="/achats">
          <span className="ic">🛒</span>Courses
        </NavLink>
        <NavLink to="/plus">
          <span className="ic">⋯</span>Plus
        </NavLink>
      </nav>
    </div>
  );
}

function MMore({ onClassic }: { onClassic: () => void }) {
  const [size, setSize] = useState<TextSize>(readTextSize);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const go = (to: string, icon: string, label: string, hint?: string) => (
    <li>
      <button type="button" className="m-row" onClick={() => navigate(to)}>
        <span className="ic">{icon}</span>
        <span className="txt">
          <b>{label}</b>
          {hint && <small>{hint}</small>}
        </span>
        <span className="end">›</span>
      </button>
    </li>
  );

  return (
    <div className="m-view">
      <MHeader title="Plus" subtitle={user.username} />
      <div className="m-body">
        <ul className="m-list">
          {go("/prets", "🤝", "Prêts et valeur du stock")}
          {go("/achats/prix", "💶", "Prix et fournisseurs", "Offres, historique des prix")}
          {go("/fournisseurs", "🏪", "Fournisseurs")}
          {go("/qr", "🏷️", "Étiquettes QR", "Impression, réimpression")}
          {go("/categories", "🗂️", "Catégories")}
          {go("/plans", "📐", "Plans", "À dessiner de préférence sur ordinateur")}
          {go("/reglages", "⚙️", "Réglages")}
        </ul>
        <p className="m-group">Affichage</p>
        <div className="m-textsize" role="group" aria-label="Taille du texte">
          {([["normal", "Texte normal"], ["grand", "Grand"], ["tres-grand", "Très grand"]] as const).map(([value, text]) => (
            <button
              key={value}
              type="button"
              className={size === value ? "on" : ""}
              onClick={() => {
                setSize(value);
                applyTextSize(value);
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <ul className="m-list">
          <li>
            <button type="button" className="m-row" onClick={onClassic}>
              <span className="ic">🖥️</span>
              <span className="txt">
                <b>Interface classique</b>
                <small>Revenir à l'ancien affichage sur ce téléphone</small>
              </span>
            </button>
          </li>
          <li>
            <button type="button" className="m-row" onClick={logout}>
              <span className="ic">⎋</span>
              <span className="txt">
                <b>Se déconnecter</b>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
