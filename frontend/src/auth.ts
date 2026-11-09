import { createContext, useContext } from "react";
import type { User } from "./types";

// Module séparé de App.tsx : le rechargement à chaud de App ne recrée pas le contexte.

export interface AuthState {
  user: User;
  canWrite: boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth hors du AuthContext");
  return ctx;
}
