import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, ApiError } from "./api";
import { AuthContext, type AuthState } from "./auth";
import MobileApp from "./mobile/MobileApp";
import { flushQueue, onFlushReport, usePending } from "./offline";
import { notify, Toasts } from "./toast";
import { readUiChoice, saveUiChoice, usePhone } from "./usePhone";
import Home from "./screens/Home";
import Categories from "./screens/Categories";
import LabelDetail from "./screens/LabelDetail";
import Login from "./screens/Login";
import QrManager from "./screens/QrManager";
import Achats from "./screens/Achats";
import Fournisseurs from "./screens/Fournisseurs";
import Prets from "./screens/Prets";
import PlanEditor from "./screens/PlanEditor";
import PlanModelEditor from "./screens/PlanModelEditor";
import Plans from "./screens/Plans";
import Ranger from "./screens/Ranger";
import Scan from "./screens/Scan";
import Settings from "./screens/Settings";
import { Navigate, useParams } from "react-router-dom";

/** Ancienne adresse /nodes/:id : on ouvre l'accueil avec l'élément sélectionné. */
function NodeRedirect() {
  const { id } = useParams();
  return <Navigate to={`/?n=${encodeURIComponent(id ?? "")}`} replace />;
}
import type { User } from "./types";

const USER_KEY = "mw_user";

/** Dernier utilisateur connu : permet d'ouvrir l'appli sans réseau (lecture et file d'attente des mouvements). */
function rememberUser(u: User | null): void {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Stockage indisponible : l'ouverture hors ligne ne sera pas possible.
  }
}

function recallUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

type ServerStatus = "online" | "server-down" | "offline";

const STATUS_LABEL: Record<ServerStatus, string> = {
  online: "En ligne",
  "server-down": "Serveur injoignable",
  offline: "Hors ligne",
};

/** Distingue l'absence de réseau de l'absence de réponse du serveur local. */
function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>("online");
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!navigator.onLine) {
        if (!cancelled) setStatus("offline");
        return;
      }
      try {
        const r = await fetch("/api/v1/health", { cache: "no-store" });
        if (!cancelled) setStatus(r.ok ? "online" : "server-down");
      } catch {
        if (!cancelled) setStatus("server-down");
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);
  return status;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [moreOpen, setMoreOpen] = useState(false);
  // Sur téléphone, l'interface mobile est le choix par défaut ; l'interface classique reste disponible.
  const phone = usePhone();
  const [ui, setUi] = useState(readUiChoice);
  const [bootError, setBootError] = useState<string | null>(null);
  const status = useServerStatus();
  const pending = usePending();

  // Retour du réseau (ou serveur à nouveau joignable) : on envoie les mouvements saisis hors ligne.
  useEffect(() => {
    onFlushReport((text) => notify(text));
  }, []);
  useEffect(() => {
    if (status === "online") void flushQueue();
  }, [status, pending]);
  useEffect(() => {
    const timer = window.setInterval(() => void flushQueue(), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  const queueNote = pending > 0 ? ` · ${pending} à envoyer` : "";

  useEffect(() => {
    api
      .get<User>("/auth/me")
      .then((u) => {
        rememberUser(u);
        setUser(u);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          rememberUser(null);
          setUser(null);
          return;
        }
        // Serveur ou réseau absent au démarrage : on reprend la dernière session connue (lecture depuis le cache).
        const known = recallUser();
        if (known) setUser(known);
        else setBootError(e instanceof ApiError ? e.message : "Serveur injoignable.");
      });
  }, []);

  if (bootError) return <p className="center error">{bootError} Rechargez la page quand le serveur répond.</p>;
  if (user === undefined) return <p className="center muted">Chargement…</p>;
  if (user === null)
    return (
      <Login
        onLogin={(u) => {
          rememberUser(u);
          setUser(u);
        }}
      />
    );

  const auth: AuthState = {
    user,
    canWrite: user.role !== "lecture",
    logout: async () => {
      await api.post("/auth/logout");
      rememberUser(null);
      void caches?.delete("mw-api-lecture");
      setUser(null);
    },
  };

  if (phone && ui === "mobile") {
    return (
      <AuthContext.Provider value={auth}>
        <MobileApp
          statusLabel={status === "online" && pending === 0 ? null : `${STATUS_LABEL[status]}${queueNote}`}
          onClassic={() => {
            saveUiChoice("classic");
            setUi("classic");
          }}
        />
        <Toasts />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <Toasts />
      <header className="topbar">
        <NavLink to="/" className="brand">
          MyWorkshop
        </NavLink>
        <span className={`status status-${status}`}>● {STATUS_LABEL[status]}{queueNote}</span>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ranger" element={<Ranger />} />
          <Route path="/plan/:id" element={<PlanEditor />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/:id" element={<PlanModelEditor />} />
          <Route path="/achats" element={<Achats />} />
          <Route path="/fournisseurs" element={<Fournisseurs />} />
          <Route path="/prets" element={<Prets />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/reglages" element={<Settings />} />
          <Route path="/qr" element={<QrManager />} />
          <Route path="/qr/labels/:code" element={<LabelDetail />} />
          {/* Cible des QR encodant une URL : ouvre directement l'élément étiqueté */}
          <Route path="/l/:code" element={<LabelDetail redirectAssigned />} />
          {/* Anciennes adresses d'éléments : on ouvre l'accueil, sur l'élément */}
          <Route path="/nodes/:id" element={<NodeRedirect />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <nav className="sidebar" aria-label="Menu principal">
        <NavLink to="/" end>
          Accueil
        </NavLink>
        <NavLink to="/ranger">Ranger</NavLink>
        <NavLink to="/scan">Scanner</NavLink>
        <NavLink to="/categories">Catégories</NavLink>
        <NavLink to="/plans">Plans</NavLink>
        <NavLink to="/achats">Achats</NavLink>
        <NavLink to="/fournisseurs">Fournisseurs</NavLink>
        <NavLink to="/prets">Prêts</NavLink>
        <NavLink to="/qr">Étiquettes QR</NavLink>
        <NavLink to="/reglages">Réglages</NavLink>
      </nav>
      <nav className="bottombar" aria-label="Navigation">
        <NavLink to="/" end>
          Accueil
        </NavLink>
        <NavLink to="/ranger">Ranger</NavLink>
        <NavLink to="/scan">Scanner</NavLink>
        <NavLink to="/achats">Achats</NavLink>
        <button type="button" className="bottombar-more" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}>
          Plus
        </button>
      </nav>
      {moreOpen && (
        <div className="sheet-overlay" onClick={() => setMoreOpen(false)}>
          <div className="sheet-panel" role="dialog" aria-modal="true" aria-label="Plus" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="sheet-head">
              <strong>Plus</strong>
              <button type="button" className="secondary" onClick={() => setMoreOpen(false)}>
                Fermer
              </button>
            </div>
            <nav className="more-list" aria-label="Autres écrans" onClick={() => setMoreOpen(false)}>
              <NavLink to="/categories">Catégories</NavLink>
              <NavLink to="/plans">Plans</NavLink>
              <NavLink to="/fournisseurs">Fournisseurs</NavLink>
              <NavLink to="/prets">Prêts</NavLink>
              <NavLink to="/qr">Étiquettes QR</NavLink>
              <NavLink to="/reglages">Réglages</NavLink>
            </nav>
            <button
              type="button"
              className="secondary"
              style={{ width: "100%", marginTop: "0.8rem" }}
              onClick={() => {
                saveUiChoice("mobile");
                setUi("mobile");
                setMoreOpen(false);
              }}
            >
              Passer à l'interface mobile
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}
