import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, ApiError } from "./api";
import { AuthContext, type AuthState } from "./auth";
import Home from "./screens/Home";
import LabelDetail from "./screens/LabelDetail";
import Login from "./screens/Login";
import QrManager from "./screens/QrManager";
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
  const [bootError, setBootError] = useState<string | null>(null);
  const status = useServerStatus();

  useEffect(() => {
    api
      .get<User>("/auth/me")
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setUser(null);
        else setBootError(e instanceof ApiError ? e.message : "Serveur injoignable.");
      });
  }, []);

  if (bootError) return <p className="center error">{bootError} Rechargez la page quand le serveur répond.</p>;
  if (user === undefined) return <p className="center muted">Chargement…</p>;
  if (user === null) return <Login onLogin={setUser} />;

  const auth: AuthState = {
    user,
    canWrite: user.role !== "lecture",
    logout: async () => {
      await api.post("/auth/logout");
      setUser(null);
    },
  };

  return (
    <AuthContext.Provider value={auth}>
      <header className="topbar">
        <NavLink to="/" className="brand">
          MyWorkshop
        </NavLink>
        <span className={`status status-${status}`}>● {STATUS_LABEL[status]}</span>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ranger" element={<Ranger />} />
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
        <NavLink to="/qr">Étiquettes QR</NavLink>
        <NavLink to="/reglages">Réglages</NavLink>
      </nav>
      <nav className="bottombar" aria-label="Navigation">
        <NavLink to="/" end>
          Accueil
        </NavLink>
        <NavLink to="/ranger">Ranger</NavLink>
        <NavLink to="/scan">Scanner</NavLink>
        <NavLink to="/qr">Étiquettes</NavLink>
        <NavLink to="/reglages">Réglages</NavLink>
      </nav>
    </AuthContext.Provider>
  );
}
