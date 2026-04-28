"use client";

/**
 * Persistent token storage.
 *
 * - `admin_token` goes to localStorage: survives reloads, expected to be
 *   used by a long-lived admin workstation session.
 * - `table_token` goes to sessionStorage: tied to the tab/device the QR
 *   was scanned from; should not leak across tabs.
 * - `session_token` also in sessionStorage: it is only meaningful while the
 *   session is open, and we actively clear it when the session is closed.
 *
 * All reads are guarded against SSR so imports are safe in server components.
 */

const ADMIN_TOKEN_KEY = "coffee.admin_token";
const SESSION_TOKEN_KEY = "coffee.session_token";
const TABLE_TOKEN_KEY = "coffee.table_token";

function isBrowser() {
  return typeof window !== "undefined";
}

// ─── Admin ────────────────────────────────────────────────────────────────
export function getAdminToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string) {
  if (!isBrowser()) return;
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

// ─── Session (customer after /table-sessions/open) ───────────────────────
export function getSessionToken(): string | null {
  if (!isBrowser()) return null;
  return window.sessionStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string) {
  if (!isBrowser()) return;
  window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken() {
  if (!isBrowser()) return;
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

// ─── Table (customer coming from QR) ─────────────────────────────────────
export function getTableToken(): string | null {
  if (!isBrowser()) return null;
  return window.sessionStorage.getItem(TABLE_TOKEN_KEY);
}

export function setTableToken(token: string) {
  if (!isBrowser()) return;
  window.sessionStorage.setItem(TABLE_TOKEN_KEY, token);
}

export function clearTableToken() {
  if (!isBrowser()) return;
  window.sessionStorage.removeItem(TABLE_TOKEN_KEY);
}
