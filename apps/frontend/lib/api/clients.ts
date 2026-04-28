import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import {
  clearAdminToken,
  getAdminToken,
  getSessionToken,
  getTableToken,
} from "../auth/token-storage";

/**
 * Three API clients, one per audience. Each one attaches a fixed kind of
 * token so call sites never have to guess — if you need admin behavior,
 * you import `adminApi`; if you need customer behavior, `customerApi`.
 *
 * Why this instead of a single "smart" axios that picks a token per URL:
 * the server already enforces `kind` on every endpoint (Phase G3), so the
 * only reason to swap tokens per route would be client-side heuristics —
 * which turn into bugs the first time a new endpoint path sneaks past the
 * heuristic.
 */

function resolveApiBaseUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001/api`;
  }
  return "http://localhost:3001/api";
}

function createClient(
  tokenGetter: () => string | null,
  label: string,
): AxiosInstance {
  const instance = axios.create({
    baseURL: resolveApiBaseUrl(),
    timeout: 10_000,
    headers: { "Content-Type": "application/json" },
  });

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = tokenGetter();
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }
    return config;
  });

  instance.defaults.headers.common["X-Client"] = label;
  return instance;
}

// ─── Admin / staff client ─────────────────────────────────────────────────
// Used by the /admin pages. Attaches admin_token from localStorage. Never
// call this with a session/table token.
export const adminApi = createClient(getAdminToken, "admin");

/**
 * When admin API returns 401/403, the token is either expired or revoked.
 * Surface that to the app via a pluggable callback so we do not couple this
 * file to next/navigation. The AuthProvider registers a real callback on
 * mount; until then we default to a hard redirect.
 */
let onAdminAuthFailure: () => void = () => {
  if (typeof window !== "undefined") {
    clearAdminToken();
    if (window.location.pathname.startsWith("/admin")) {
      window.location.href = "/admin/login";
    }
  }
};

export function registerAdminAuthFailureHandler(fn: () => void) {
  onAdminAuthFailure = fn;
}

adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      onAdminAuthFailure();
    }
    return Promise.reject(error);
  },
);

// ─── Customer session client ──────────────────────────────────────────────
// Used after POST /table-sessions/open: bill, orders, order-requests,
// queue:add, etc. Attaches session_token from sessionStorage.
export const customerApi = createClient(getSessionToken, "session");

/**
 * 401/403 on the customer client means the session token was rejected.
 * The mesa page registers a handler that flips its `sessionInvalid` flag
 * and shows the "scan again" recovery card. We default to a noop (silent
 * reject) so non-mesa contexts don't crash if they happen to call this.
 */
let onCustomerAuthFailure: () => void = () => {};

export function registerCustomerAuthFailureHandler(fn: () => void) {
  onCustomerAuthFailure = fn;
}

customerApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      onCustomerAuthFailure();
    }
    return Promise.reject(error);
  },
);

// ─── Table client (QR → pre-session) ──────────────────────────────────────
// Used only for the two endpoints that run before a session exists:
//   - GET /tables/:id/session/current
//   - POST /table-sessions/open
// Attaches table_token from sessionStorage.
export const tableApi = createClient(getTableToken, "table");

// ─── Public client (no token) ─────────────────────────────────────────────
// Products catalog, music search, queue reads, health. Exported for call
// sites that are explicitly public.
export const publicApi = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 10_000,
  headers: { "Content-Type": "application/json" },
});
publicApi.defaults.headers.common["X-Client"] = "public";
