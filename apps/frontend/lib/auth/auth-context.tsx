"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { adminApi, registerAdminAuthFailureHandler } from "../api/clients";
import {
  clearAdminToken,
  getAdminToken,
  setAdminToken,
} from "./token-storage";

export type AdminUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "staff";
  is_active: boolean;
};

type AuthStatus =
  | "idle" // first render — still checking storage
  | "authenticated"
  | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AdminUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /**
   * Exposed so protected layouts can trigger a refresh if they suspect the
   * token was revoked server-side. Normally the 401 handler covers it.
   */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("idle");

  const clear = useCallback(() => {
    clearAdminToken();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const refresh = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      clear();
      return;
    }
    try {
      const res = await adminApi.get<AdminUser>("/auth/me");
      setUser(res.data);
      setStatus("authenticated");
    } catch {
      clear();
    }
  }, [clear]);

  // Hydrate on mount. If a token is in localStorage we verify it via /auth/me
  // before trusting it — this catches revocation between sessions and avoids
  // flashing an admin UI that will immediately 401.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Central handler for 401/403 coming from admin API calls.
  useEffect(() => {
    registerAdminAuthFailureHandler(() => {
      clear();
      if (
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/admin") &&
        window.location.pathname !== "/admin/login"
      ) {
        window.location.href = "/admin/login";
      }
    });
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await adminApi.post<{ token: string; user: AdminUser }>(
      "/auth/login",
      { email, password },
    );
    setAdminToken(res.data.token);
    setUser(res.data.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    clear();
    if (typeof window !== "undefined") {
      window.location.href = "/admin/login";
    }
  }, [clear]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, refresh }),
    [status, user, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  }
  return ctx;
}
