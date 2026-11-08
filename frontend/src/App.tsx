import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, ApiError } from "./api";
import ArticleDetailScreen from "./screens/ArticleDetail";
import ArticleNew from "./screens/ArticleNew";
import Home from "./screens/Home";
import Login from "./screens/Login";
import Nodes from "./screens/Nodes";
import Search from "./screens/Search";
import type { User } from "./types";

interface AuthState {
  user: User;
  canWrite: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth hors du AuthContext");
  return ctx;
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
          <Route path="/search" element={<Search />} />
          <Route path="/articles/new" element={<ArticleNew />} />
          <Route path="/articles/:id" element={<ArticleDetailScreen />} />
          <Route path="/nodes" element={<Nodes />} />
          <Route path="/nodes/:id" element={<Nodes />} />
          <Route path="*" element={<p className="muted">Page introuvable.</p>} />
        </Routes>
      </main>
      <nav className="bottombar">
        <NavLink to="/" end>
          Accueil
        </NavLink>
        <NavLink to="/search">Rechercher</NavLink>
        {auth.canWrite && <NavLink to="/articles/new">Ajouter</NavLink>}
        <NavLink to="/nodes">Emplacements</NavLink>
      </nav>
    </AuthContext.Provider>
  );
}
