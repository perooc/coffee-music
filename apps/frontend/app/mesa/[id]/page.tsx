"use client";

import { useEffect, use, useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  useAppStore,
  selectCurrentPlayback,
  selectMyQueueCount,
} from "@/store";
import { useSocket, reconnectSocketWithFreshAuth } from "@/lib/socket/useSocket";
import {
  accessCodeApi,
  tableSessionsApi,
  queueApi,
  ordersApi,
  orderRequestsApi,
  billApi,
  playbackApi,
  productsApi,
} from "@/lib/api/services";
import {
  clearSessionToken,
  getSessionToken,
  getTableToken,
  setSessionToken,
  setTableToken,
} from "@/lib/auth/token-storage";
import { registerCustomerAuthFailureHandler } from "@/lib/api/clients";
import type {
  BillView,
  Order,
  OrderRequest,
  PlaybackState,
  Product,
  QueueItem,
  Table,
  TableSession,
} from "@coffee-bar/shared";
import {
  MAX_SONGS_PER_TABLE,
  EXTRA_SONG_CONSUMPTION_THRESHOLD,
  effectiveSongLimit,
} from "@coffee-bar/shared";
import SongSearch from "@/components/music/SongSearch";
import { MySongsPanel } from "@/components/music/MySongsPanel";
import { OrderRequestCart } from "@/components/orders/OrderRequestCart";
import { CustomerBillModal } from "@/components/orders/CustomerBillModal";
import { TrackTitleMarquee } from "@/components/music/TrackTitleMarquee";
import {
  C,
  FONT_HEADING,
  FONT_DISPLAY,
  FONT_UI,
  FONT_MONO,
  SHARED_KEYFRAMES,
  THEME_CSS_VARS,
  fmt,
  pad,
  secToMin,
} from "@/lib/theme";

function buildMesaQueue(
  tableQueue: QueueItem[],
  tableId: number,
  sessionStartIso?: string | null,
) {
  // `sessionStartIso` keeps the customer view scoped to the current
  // session — without it, items queued by a previous occupant of the same
  // physical table would still appear here.
  //
  // We include BOTH pending and playing items: when a song from this
  // table is currently playing, the backend counts it toward the per-
  // table limit (so does the customer counter "X/5"). Excluding it here
  // caused a desync where the UI showed 4/5 but the server had already
  // accepted 5 and rejected the 6th with QUEUE_LIMIT_REACHED.
  const sinceMs = sessionStartIso
    ? new Date(sessionStartIso).getTime()
    : null;
  return tableQueue
    .filter(
      (item) =>
        item.table_id === tableId &&
        (item.status === "pending" || item.status === "playing") &&
        (sinceMs == null || new Date(item.created_at).getTime() >= sinceMs),
    )
    .sort((a, b) => a.position - b.position);
}

function dedupeById<T extends { id: number }>(items: T[]) {
  const unique = new Map<number, T>();

  for (const item of items) {
    unique.set(item.id, item);
  }

  return Array.from(unique.values());
}

function upsertById<T extends { id: number }>(items: T[], nextItem: T) {
  const exists = items.some((item) => item.id === nextItem.id);

  return exists
    ? items.map((item) => (item.id === nextItem.id ? nextItem : item))
    : [nextItem, ...items];
}

/**
 * Best-effort decode of `session_id` from the JWT payload. We do NOT verify
 * the signature — this is only used to detect a stale local token (one that
 * targets a different session than the one the server currently has open
 * for the table). The backend will still verify any token that survives.
 */
function decodeJwtSessionId(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as Record<string, unknown>;
    if (typeof payload.session_id === "number") return payload.session_id;
    return null;
  } catch {
    return null;
  }
}

type TabKey = "cola" | "canciones" | "pedidos";

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MesaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const tableId = parseInt(id, 10);
  const searchParams = useSearchParams();
  const [globalQueue, setGlobalQueue] = useState<QueueItem[]>([]);
  // `undefined` = still loading; `null` = no open session, render entry view.
  const [session, setSession] = useState<TableSession | null | undefined>(
    undefined,
  );
  const [bill, setBill] = useState<BillView | null>(null);
  const [openingSession, setOpeningSession] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  // Mirrors session.opened_at so socket-driven callbacks (which capture
  // their `session` value at registration time) can still scope queue
  // filtering by the current session start.
  const sessionStartRef = useRef<string | null>(null);
  // In-page toasts for payment lifecycle moments. Local because the
  // dispatch logic lives entirely on this screen.
  const [toasts, setToasts] = useState<
    { id: number; tone: "olive" | "gold" | "cacao"; message: string }[]
  >([]);
  const pushToast = useCallback(
    (tone: "olive" | "gold" | "cacao", message: string) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, tone, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    },
    [],
  );
  // QR/table token plumbing.
  //   "checking" — first paint, before we have read the URL/storage.
  //   "ok"       — we have a table token (from ?t=... or sessionStorage).
  //   "missing"  — no token anywhere. Show "QR inválido".
  const [tableTokenStatus, setTableTokenStatus] = useState<
    "checking" | "ok" | "missing"
  >("checking");
  // Set when the customer client gets a 401/403 from the API. The session
  // token has expired or been revoked; we cannot keep operating, so we render
  // a recovery card asking the user to scan the QR again.
  const [sessionInvalid, setSessionInvalid] = useState(false);
  // Per-device gate: every customer device must validate the current
  // 4-digit bar code before opening/joining a session. We persist the
  // ID of the validated code in sessionStorage; on every visit we read
  // the current code id from the backend and compare. If the staff has
  // rotated the code since this device validated, the IDs won't match
  // and the gate reappears. This closes the bug where a stale
  // sessionStorage flag let an old device skip the gate forever.
  const [accessCodeOk, setAccessCodeOk] = useState<boolean>(false);
  const [accessCodeChecking, setAccessCodeChecking] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    accessCodeApi
      .getForDisplay()
      .then((current) => {
        if (cancelled) return;
        let storedId: number | null = null;
        try {
          const raw = sessionStorage.getItem("bar_access_ok");
          if (raw && /^\d+$/.test(raw)) storedId = Number(raw);
        } catch {
          /* ignore — Safari private mode */
        }
        // Match? device already passed the gate for *this* code.
        if (storedId === current.id) {
          setAccessCodeOk(true);
        } else {
          // Either no flag, or the code rotated since validation. Wipe
          // the stale value so we don't accidentally re-trust it on a
          // race with a future rotation.
          try {
            sessionStorage.removeItem("bar_access_ok");
          } catch {
            /* ignore */
          }
          setAccessCodeOk(false);
        }
      })
      .catch(() => {
        // If the public endpoint fails, fall back to "ask for code".
        setAccessCodeOk(false);
      })
      .finally(() => {
        if (!cancelled) setAccessCodeChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markAccessCodeOk = useCallback((codeId: number) => {
    setAccessCodeOk(true);
    try {
      sessionStorage.setItem("bar_access_ok", String(codeId));
    } catch {
      // ignore — Safari private mode etc.
    }
  }, []);
  // Session-scoped OrderRequests (mine). Catalog / cart stay separated.
  const [myRequests, setMyRequests] = useState<OrderRequest[]>([]);
  // Catalog: backend-owned, hydrated once. Cart inside modal is local-only.
  const [products, setProducts] = useState<Product[]>([]);
  // The cart modal has two purposes — creating a fresh request and editing
  // a still-pending one. Modeling the union makes the active mode explicit
  // (no booleans + "did I forget the editing payload?" bugs).
  type CartMode =
    | { kind: "closed" }
    | { kind: "create" }
    | { kind: "edit"; request: OrderRequest };
  const [cartMode, setCartMode] = useState<CartMode>({ kind: "closed" });
  const cartOpen = cartMode.kind !== "closed";
  const closeCart = useCallback(() => setCartMode({ kind: "closed" }), []);
  const [billModalOpen, setBillModalOpen] = useState(false);

  const {
    currentTable,
    setCurrentTable,
    queue,
    updateFromSocket,
    orders,
    setOrders,
    mySongs,
    setMySongs,
    isSearchOpen,
    setSearchOpen,
    activeTab,
    setActiveTab,
    upsertOrder,
    setCurrentPlayback,
  } = useAppStore();

  const currentPlayback = useAppStore(selectCurrentPlayback);
  const myQueueCount = useAppStore(selectMyQueueCount(tableId));

  const clearMesaSessionState = useCallback(() => {
    // Clear ONLY the session token. The table token survives so the same
    // device can scan-less re-enter the entry view and start a new session.
    clearSessionToken();
    // The bar access code gate must be re-validated for the next
    // session — we cleared the session, so the device shouldn't carry
    // the green light from the previous one.
    try {
      sessionStorage.removeItem("bar_access_ok");
    } catch {
      /* ignore */
    }
    setAccessCodeOk(false);
    setSession(null);
    setBill(null);
    setOrders([]);
    setMyRequests([]);
    closeCart();
    setSearchOpen(false);
    setMySongs([]);
    updateFromSocket([]);
    setActiveTab("cola");
  }, [
    setOrders,
    setSearchOpen,
    setMySongs,
    updateFromSocket,
    setActiveTab,
    closeCart,
  ]);

  const hydrateSessionData = useCallback(
    async (sessionToHydrate: TableSession) => {
      // These four calls share the same auth context (session_token), so
      // they must not run before a session exists. The pre-session entry
      // view does NOT call this; it only renders the public surface.
      // Queue calls are scoped to `session.opened_at` so the customer
      // never inherits queue items from a previous occupant of the same
      // physical table.
      const since = sessionToHydrate.opened_at;
      const [nextBill, nextOrders, nextRequests, tableQueue, tableQueueHistory] =
        await Promise.all([
          billApi.getForSession(sessionToHydrate.id),
          ordersApi.getAllForSession(sessionToHydrate.id),
          orderRequestsApi.getAllForSession(sessionToHydrate.id),
          queueApi.getByTable(tableId, { since }),
          queueApi.getByTableWithHistory(tableId, { since }),
        ]);

      setBill(nextBill);
      setOrders(dedupeById(nextOrders));
      setMyRequests(dedupeById(nextRequests));
      updateFromSocket(buildMesaQueue(tableQueue, tableId, since));
      setMySongs(dedupeById(tableQueueHistory));
    },
    [setOrders, tableId, updateFromSocket, setMySongs],
  );

  // Keep the ref in sync with the live session so socket callbacks below
  // always see the right scope.
  useEffect(() => {
    sessionStartRef.current = session?.opened_at ?? null;
  }, [session?.opened_at]);

  // Detect user-visible payment transitions and fire toasts. We compare
  // against a ref of the previous session — NOT against the previous state
  // inside `setSession` — because in React strict mode (dev) the updater
  // callback runs twice, which used to fire each toast twice.
  const prevSessionRef = useRef<TableSession | null>(null);
  useEffect(() => {
    const prev = prevSessionRef.current;
    const next = session ?? null;
    if (prev && next && prev.id === next.id) {
      if (!prev.payment_requested_at && next.payment_requested_at) {
        pushToast("gold", "Cuenta solicitada — el bar se acercará pronto.");
      }
      // null → paid_at: admin processed the payment. The session also
      // transitions to `closed` immediately, so this toast flashes briefly
      // before the entry view takes over (the closed handler clears state).
      if (!prev.paid_at && next.paid_at) {
        pushToast("olive", "Cuenta pagada — ¡gracias por tu visita!");
      }
    }
    prevSessionRef.current = next;
  }, [session, pushToast]);

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => {
      const since = sessionStartRef.current;
      updateFromSocket(buildMesaQueue(q, tableId, since));
      setGlobalQueue(q);
      const sinceMs = since ? new Date(since).getTime() : null;
      const prev = useAppStore.getState().mySongs;
      const history = prev.filter(
        (s) => s.status === "played" || s.status === "skipped",
      );
      const freshActive = q.filter(
        (item) =>
          item.table_id === tableId &&
          (sinceMs == null ||
            new Date(item.created_at).getTime() >= sinceMs),
      );
      setMySongs(dedupeById([...freshActive, ...history]));
    },
    [tableId, updateFromSocket, setMySongs],
  );
  const handleTableUpdated = useCallback(
    (t: Partial<Table> & { id: number }) => {
      if (t.id === tableId) {
        // Merge partial table update into current; fairness + counters live here.
        setCurrentTable({ ...(currentTable ?? ({} as Table)), ...t } as Table);
      }
    },
    [tableId, setCurrentTable, currentTable],
  );
  const handleOrderCreatedOrUpdated = useCallback(
    (o: Order) => {
      if (session && o.table_session_id === session.id) upsertOrder(o);
    },
    [session, upsertOrder],
  );
  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );
  const handleBillUpdated = useCallback(
    (b: BillView) => {
      if (session && b.session_id === session.id) setBill(b);
    },
    [session],
  );
  const handleSessionClosed = useCallback(
    (closed: TableSession) => {
      if (session && closed.id === session.id) {
        // Bar closed our session — kick back to entry view.
        clearMesaSessionState();
      }
    },
    [session, clearMesaSessionState],
  );
  // Backend emits this on request-payment and cancel-payment-request.
  // (mark-paid closes the session and arrives via onTableSessionClosed.)
  // Merge the patch into the current session — toast detection lives in
  // a separate useEffect to avoid double-firing under React strict mode.
  const handleTableSessionUpdated = useCallback(
    (patch: Partial<TableSession> & { id: number }) => {
      setSession((prev) => {
        if (!prev || prev.id !== patch.id) return prev;
        return { ...prev, ...patch };
      });
    },
    [],
  );
  const handleOrderRequestUpdated = useCallback(
    (r: OrderRequest) => {
      if (!session || r.table_session_id !== session.id) return;
      setMyRequests((prev) => upsertById(prev, r));
    },
    [session],
  );
  const handleSocketReconnect = useCallback(async () => {
    try {
      const latestSession = await tableSessionsApi.getCurrentForTable(tableId);

      if (!latestSession) {
        clearMesaSessionState();
        return;
      }

      setSession(latestSession);
      await hydrateSessionData(latestSession);
    } catch (error) {
      console.error(error);
    }
  }, [tableId, clearMesaSessionState, hydrateSessionData]);

  useSocket({
    sessionId: session?.id,
    onQueueUpdated: handleQueueUpdated,
    onTableUpdated: handleTableUpdated,
    onOrderCreated: handleOrderCreatedOrUpdated,
    onOrderUpdated: handleOrderCreatedOrUpdated,
    onOrderRequestCreated: handleOrderRequestUpdated,
    onOrderRequestUpdated: handleOrderRequestUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
    onBillUpdated: handleBillUpdated,
    onTableSessionUpdated: handleTableSessionUpdated,
    onTableSessionClosed: handleSessionClosed,
    onReconnect: handleSocketReconnect,
  });

  // Wire the global customerApi 401/403 handler so any unexpected auth
  // failure on a session-scoped call surfaces the recovery card instead of
  // a silent console error.
  useEffect(() => {
    registerCustomerAuthFailureHandler(() => setSessionInvalid(true));
    return () => {
      registerCustomerAuthFailureHandler(() => {});
    };
  }, []);

  // ─── QR table token plumbing ─────────────────────────────────────────────
  // The QR code links to /mesa/:id?t=<table_token>. We persist the token in
  // sessionStorage so subsequent navigations within the same tab don't need
  // the query string. If the URL ships a fresh token we let it overwrite the
  // stored one (e.g. the bar reprinted the QR with a rotated secret).
  useEffect(() => {
    if (isNaN(tableId)) return;
    const queryToken = searchParams?.get("t");
    if (queryToken && queryToken.trim()) {
      setTableToken(queryToken.trim());
      setTableTokenStatus("ok");
      return;
    }
    const stored = getTableToken();
    setTableTokenStatus(stored ? "ok" : "missing");
  }, [tableId, searchParams]);

  // Initial load — only public + table-token endpoints. Anything that
  // requires a session_token waits until `hydrateSessionData`. Anything
  // that requires an admin_token (e.g. /tables/:id) is NOT called here at
  // all — the customer doesn't need raw Table rows; we synthesize the
  // minimum metadata for display from the URL `tableId`.
  useEffect(() => {
    if (isNaN(tableId)) return;
    if (tableTokenStatus !== "ok") return;
    sessionStorage.setItem("table_id", String(tableId));

    // Synthetic Table row for display until a session arrives. We treat
    // `tableId` as the visible number — that matches how the seed builds
    // tables. When the session loads we re-derive from session.table_id.
    setCurrentTable({
      id: tableId,
      number: tableId,
      qr_code: `mesa-${tableId}`,
      status: "occupied",
      current_session_id: null,
      total_consumption: 0,
      active_order_count: 0,
      pending_request_count: 0,
      last_activity_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Table);

    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
    queueApi.getGlobal().then(setGlobalQueue).catch(console.error);
    productsApi.getAll().then(setProducts).catch(console.error);

    tableSessionsApi
      .getCurrentForTable(tableId)
      .then((s) => {
        // No token in this device → render the entry view so the user
        // taps "Iniciar mesa" and joins the existing session (or opens
        // a new one if there is none). Without a token we can't make
        // session-scoped calls, so we don't try.
        const stored = getSessionToken();
        if (s && !stored) {
          setSession(null);
          return;
        }
        // Multi-device sharing: a token whose embedded session_id no
        // longer matches the table's current session means a new session
        // started since this device last used the app (the bar closed
        // the previous one and a new group is sitting now, or a reseed
        // happened). Drop the stale token but DON'T evict if the ids
        // match — that case is normal and means we're rejoining.
        if (s && stored) {
          const payloadId = decodeJwtSessionId(stored);
          if (payloadId != null && payloadId !== s.id) {
            clearSessionToken();
            setSession(null);
            return;
          }
        }
        setSession(s);
      })
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        // 401/403 here means the table token is invalid (revoked, secret
        // rotated, or the user landed without `?t=`). Surface the recovery
        // card so they scan the QR again.
        if (status === 401 || status === 403) {
          setSessionInvalid(true);
          return;
        }
        console.error(err);
        setSession(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, tableTokenStatus]);

  // When a session is known, fetch session-scoped data (bill + orders +
  // requests). Keyed on session.id only, not the whole `session` object,
  // so socket-driven patches (payment_requested_at toggling, total bumps)
  // don't cause an entire re-hydrate. Subsequent updates arrive via
  // their own socket events; this effect is the cold-start hydrate.
  const sessionId = session?.id;
  useEffect(() => {
    if (sessionId == null) {
      setBill(null);
      setOrders([]);
      setMyRequests([]);
      return;
    }
    // Read the latest session via the closure on every fire — fine because
    // the effect only fires when the id changes.
    const current = session;
    if (!current) return;
    hydrateSessionData(current).catch((err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      // 401/403: token expired or revoked.
      // 404: the session_id we held is gone (admin closed it, DB reseeded,
      // etc). Same recovery: invalidate the local session, drop the stale
      // session_token, and ask the customer to scan the QR again.
      if (status === 401 || status === 403 || status === 404) {
        clearSessionToken();
        setSessionInvalid(true);
        return;
      }
      console.error(err);
    });
    // Intentionally exclude `session` from deps; we only want to refire
    // when the id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, setOrders, hydrateSessionData]);

  async function handleStartSession() {
    setOpenError(null);
    setOpeningSession(true);
    try {
      const created = await tableSessionsApi.open(tableId);
      // Persist the session token BEFORE marking the session as live so that
      // - subsequent customerApi requests carry the bearer
      // - the socket's auth callback (re-)resolves to a session token
      //   when reconectamos abajo.
      setSessionToken(created.session_token);
      const { session_token: _ignored, ...session } = created;
      void _ignored;
      // ORDEN CRÍTICO: primero setSession(...) para que useSocket
      // observe el sessionId nuevo y dispare un joinRooms del room
      // `tableSession:{id}`. Recién después reconectamos el socket
      // para que el handshake lleve la auth fresca. Antes hacíamos
      // reconnect → setSession y el `connect` event llegaba antes
      // de que useSocket conociera el sessionId, dejando al cliente
      // fuera del room — los eventos del admin nunca llegaban.
      setSession(session);
      // Forzar reconnect después del setState. Doble propósito:
      //   1) Refrescar la auth (de anonymous → session token).
      //   2) Disparar `connect` que vuelve a invocar joinRooms con
      //      el sessionId ya seteado.
      reconnectSocketWithFreshAuth();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 401 || status === 403) {
        // Table token was rejected — likely the secret was rotated.
        setSessionInvalid(true);
        return;
      }
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "No se pudo iniciar la mesa. Intenta de nuevo.";
      setOpenError(msg);
    } finally {
      setOpeningSession(false);
    }
  }

  // Per-session song-credit ledger (shipped in the table snapshot via
  // socket). Mirrors the backend rule: 5 base slots + 1 extra per
  // delivered order >= $20k that hasn't been spent yet. If admin skips an
  // extra song the credit is automatically refunded by the backend.
  const songCredits = currentTable?.current_session?.song_credits ?? {
    earned: 0,
    spent: 0,
    available: 0,
  };
  const effectiveLimit = effectiveSongLimit(songCredits);
  const disabled = myQueueCount >= effectiveLimit;
  // Order creation is locked once the customer asks for the bill. The
  // customer can cancel the request to unlock. Paid sessions are closed,
  // so the entry view takes over and this screen is no longer rendered.
  const orderCreationDisabled =
    session?.status === "closed" || !!session?.payment_requested_at;

  // ─── No QR token at all → "QR inválido" ──────────────────────────────────
  if (tableTokenStatus === "missing") {
    return (
      <CustomerErrorCard
        eyebrow="— Mesa"
        title="QR inválido"
        body="No detectamos un código válido para esta mesa. Vuelve a escanear el QR de la mesa para continuar."
      />
    );
  }

  // ─── Token rejected by the server (expired, rotated, revoked) ───────────
  if (sessionInvalid) {
    return (
      <CustomerErrorCard
        eyebrow="— Sesión"
        title="Sesión expirada"
        body="Tu acceso a esta mesa ya no es válido. Por favor escanea el QR de la mesa nuevamente."
      />
    );
  }

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (
    tableTokenStatus === "checking" ||
    !currentTable ||
    session === undefined
  ) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: C.cream,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.mute,
          fontFamily: FONT_MONO,
          letterSpacing: 3,
          fontSize: 11,
          textTransform: "uppercase",
        }}
      >
        Cargando mesa {pad(tableId)}...
      </div>
    );
  }

  // ─── Entry state — no open session yet ───────────────────────────────────
  if (session === null) {
    // Avoid a flash of the gate while we're still resolving whether
    // sessionStorage already has a valid id. Once `accessCodeChecking`
    // flips to false, we know whether to render gate or entry view.
    if (accessCodeChecking) {
      return (
        <div
          style={{
            minHeight: "100dvh",
            background: C.cream,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: C.mute,
            fontFamily: FONT_MONO,
            letterSpacing: 3,
            fontSize: 11,
            textTransform: "uppercase",
          }}
        >
          Verificando acceso...
        </div>
      );
    }
    if (!accessCodeOk) {
      return (
        <AccessCodeGate
          tableNumber={currentTable.number ?? tableId}
          onSuccess={markAccessCodeOk}
        />
      );
    }
    return (
      <TableEntryView
        table={currentTable}
        onStart={handleStartSession}
        loading={openingSession}
        error={openError}
      />
    );
  }

  // ─── Active session view ─────────────────────────────────────────────────
  const sessionOrders = orders.filter((o) => o.table_session_id === session.id);
  const billTotal = bill?.summary.total ?? 0;
  // Active orders (not yet delivered) + pending requests block "ask for
  // bill". Mirrors the backend rule.
  const inFlightCount =
    sessionOrders.filter(
      (o) =>
        o.status === "accepted" ||
        o.status === "preparing" ||
        o.status === "ready",
    ).length +
    myRequests.filter((r) => r.status === "pending").length;

  // Per-session order numbering. The backend `id` is a global autoincrement
  // (so a fresh table sees "Pedido #47" if the bar has been busy). Customers
  // expect "#1" for their first order of the night. We compute the local
  // number by sorting all OrderRequests of THIS session by created_at and
  // assigning index+1 — this stays stable across cancellations because we
  // never re-pack the sequence; a cancelled request just leaves a gap-less
  // human number that already shipped to the customer's screen.
  // Orders inherit the number of their parent OrderRequest, so the customer
  // sees the same "#3" whether they're looking at the request (En revisión)
  // or the resulting order (En preparación / Entregados).
  const sessionRequestsSorted = [...myRequests].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const requestNumberById = new Map<number, number>();
  sessionRequestsSorted.forEach((r, i) => requestNumberById.set(r.id, i + 1));
  const orderNumberById = new Map<number, number>();
  for (const o of sessionOrders) {
    const reqNum = o.order_request_id
      ? requestNumberById.get(o.order_request_id)
      : undefined;
    if (reqNum != null) orderNumberById.set(o.id, reqNum);
  }

  return (
    <>
      <style>{styles}</style>

      <div className="mesa-root">
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/*  DESKTOP LEFT SIDEBAR (hidden on mobile)                             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <aside className="mesa-sidebar">
          <ScoreboardPanel table={currentTable} playback={currentPlayback} />
        </aside>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/*  MAIN CONTENT                                                         */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <main className="mesa-main">
          {/* Brand watermark inside the main panel */}
          <div className="mesa-watermark" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" />
          </div>

          {/* Mobile header — compact mesa # + state */}
          <header className="mesa-mobile-header">
            <div className="mesa-mobile-mesa-badge">
              <span className="mesa-mobile-mesa-label">MESA</span>
              <span className="mesa-mobile-mesa-num">{pad(currentTable.id)}</span>
            </div>
            <StatusPill playback={currentPlayback} />
          </header>

          {/* Mobile now-playing card */}
          <div className="mesa-mobile-now">
            <NowPlayingCard playback={currentPlayback} compact />
          </div>

          {/* Tabs — scrollable chips on mobile, underline on desktop */}
          <nav className="mesa-tabs" role="tablist" aria-label="Secciones de mesa">
            {(
              [
                { key: "cola", label: "COLA" },
                { key: "canciones", label: "MIS CANCIONES" },
                { key: "pedidos", label: "PEDIDOS" },
              ] as { key: TabKey; label: string }[]
            ).map(({ key, label }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  className={`mesa-tab ${active ? "is-active" : ""}`}
                  onClick={() => setActiveTab(key)}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Tab content */}
          <section className="mesa-tab-content">
            {activeTab === "cola" && (
              <QueueTab
                globalQueue={globalQueue}
                tableId={tableId}
                myQueueCount={myQueueCount}
                effectiveLimit={effectiveLimit}
              />
            )}

            {activeTab === "canciones" && (
              <MySongsPanel mySongs={mySongs} globalQueue={queue} />
            )}

            {activeTab === "pedidos" && (
              <OrdersTab
                requests={myRequests.filter(
                  (r) => r.status === "pending",
                )}
                activeOrders={sessionOrders.filter(
                  (o) =>
                    o.status === "accepted" ||
                    o.status === "preparing" ||
                    o.status === "ready",
                )}
                requestNumberById={requestNumberById}
                orderNumberById={orderNumberById}
                products={products}
                total={billTotal}
                onOpenCart={() => setCartMode({ kind: "create" })}
                onEditRequest={(r) => setCartMode({ kind: "edit", request: r })}
                onOpenBill={() => setBillModalOpen(true)}
                onRequestUpdated={(request) => {
                  setMyRequests((prev) => upsertById(prev, request));
                }}
                disableCreateOrder={orderCreationDisabled}
                paymentRequested={!!session.payment_requested_at}
                paid={!!session.paid_at}
              />
            )}
          </section>
        </main>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/*  DESKTOP RIGHT PANEL (hidden on mobile)                              */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <aside className="mesa-rightpanel">
          <NowPlayingCard playback={currentPlayback} />
          <div className="mesa-rightpanel-cta-wrap">
            <OrderProductsCTA
              onClick={() => setCartMode({ kind: "create" })}
              disabled={orderCreationDisabled}
            />
            <div style={{ height: 10 }} />
            <RequestCTA
              disabled={disabled}
              onClick={() => setSearchOpen(true)}
              effectiveLimit={effectiveLimit}
            />
            {disabled && (
              <p className="mesa-cta-hint">
                Haz un pedido de {fmt(EXTRA_SONG_CONSUMPTION_THRESHOLD)} o más
                para desbloquear otra canción
              </p>
            )}
          </div>
        </aside>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/*  MOBILE STICKY BOTTOM CTA                                            */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <div className="mesa-mobile-dock">
          <div style={{ display: "flex", gap: 8 }}>
            <OrderProductsCTA
              onClick={() => setCartMode({ kind: "create" })}
              mobile
              disabled={orderCreationDisabled}
            />
            <RequestCTA
              disabled={disabled}
              onClick={() => setSearchOpen(true)}
              mobile
              myQueueCount={myQueueCount}
              effectiveLimit={effectiveLimit}
            />
          </div>
          {disabled && (
            <p className="mesa-cta-hint">
              Pide {fmt(EXTRA_SONG_CONSUMPTION_THRESHOLD)}+ y desbloquea otra
            </p>
          )}
        </div>

        <SongSearch
          tableId={tableId}
          open={isSearchOpen}
          onClose={() => setSearchOpen(false)}
          onAdded={() => {
            const since = sessionStartRef.current ?? undefined;
            queueApi
              .getByTable(tableId, { since })
              .then((tableQueue) => {
                updateFromSocket(
                  buildMesaQueue(tableQueue, tableId, since),
                );
              })
              .catch(console.error);
            queueApi
              .getByTableWithHistory(tableId, { since })
              .then(setMySongs)
              .catch(console.error);
          }}
          myQueue={queue}
          globalQueue={globalQueue}
        />

        <OrderRequestCart
          open={cartOpen}
          onClose={closeCart}
          editing={
            cartMode.kind === "edit"
              ? {
                  requestId: cartMode.request.id,
                  // Normalize: items pueden venir con `quantity` o
                  // con `units[]` (compuestos armables). Para el cart
                  // en modo edit usamos la cantidad efectiva. La
                  // composición de armables NO se preserva — el
                  // cliente debe re-elegirla si quiere mantenerla.
                  items: Array.isArray(cartMode.request.items)
                    ? cartMode.request.items.map((it) => ({
                        product_id: it.product_id,
                        quantity:
                          typeof it.quantity === "number"
                            ? it.quantity
                            : Array.isArray(it.units)
                              ? it.units.length
                              : 0,
                      }))
                    : [],
                }
              : null
          }
          onSubmitted={(request) => {
            // Seed the new/updated request into local state right away.
            // The matching socket event will arrive shortly after but on
            // mobile Safari it sometimes drops the first event after
            // joining a fresh room — without this seed the customer's
            // first ever order would only appear after a manual refresh.
            // `upsertById` makes the later socket event a harmless no-op.
            setMyRequests((prev) => upsertById(prev, request));
          }}
          tableSessionId={session.id}
          products={products}
        />

        <CustomerBillModal
          open={billModalOpen}
          onClose={() => setBillModalOpen(false)}
          bill={bill}
          session={session}
          inFlightCount={inFlightCount}
        />

        <MesaToastStack toasts={toasts} />
      </div>
    </>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function ScoreboardPanel({
  table,
  playback,
}: {
  table: Table;
  playback: PlaybackState | null;
}) {
  return (
    <div className="mesa-scoreboard">
      <div className="mesa-scoreboard-decor" aria-hidden />

      <div className="mesa-scoreboard-head">
        <span className="mesa-caption">— Mesa</span>
        <StatusPill playback={playback} />
      </div>

      <div className="mesa-scoreboard-number">{pad(table.id)}</div>

      <div className="mesa-scoreboard-consumo">
        <span className="mesa-caption">Consumo</span>
        <span className="mesa-scoreboard-amount">{fmt(table.total_consumption)}</span>
      </div>
    </div>
  );
}

function StatusPill({ playback }: { playback: PlaybackState | null }) {
  const isPlaying = playback?.status === "playing" && playback.song;
  return (
    <div className={`mesa-status-pill ${isPlaying ? "is-playing" : ""}`}>
      <span className="mesa-status-dot-wrap">
        <span className="mesa-status-dot-ping" aria-hidden />
        <span className="mesa-status-dot" />
      </span>
      <span className="mesa-status-text">
        {isPlaying ? "SONANDO" : "EN PAUSA"}
      </span>
      {isPlaying && (
        <span className="mesa-eq" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      )}
    </div>
  );
}

function NowPlayingCard({
  playback,
  compact,
}: {
  playback: PlaybackState | null;
  compact?: boolean;
}) {
  const isPlaying = playback?.status === "playing" && playback.song;

  return (
    <div className={`mesa-npcard ${compact ? "is-compact" : ""} ${isPlaying ? "is-live" : ""}`}>
      <span className="mesa-npcard-sweep" aria-hidden />
      <div className="mesa-npcard-artwork" aria-hidden>
        <div className="mesa-npcard-artwork-inner" />
      </div>

      <div className="mesa-npcard-body">
        <div className="mesa-npcard-eyebrow">
          <span className="mesa-caption">
            {isPlaying ? "♪ Sonando ahora" : "En silencio"}
          </span>
          {isPlaying && <span className="mesa-live-tag">● LIVE</span>}
        </div>

        {isPlaying ? (
          <>
            <TrackTitleMarquee
              text={playback.song?.title ?? ""}
              className="mesa-npcard-title"
            />
            <p className="mesa-npcard-meta">
              {secToMin(playback.song?.duration ?? 0)} · Mesa{" "}
              {playback.table_id ? pad(playback.table_id) : "ADMIN"}
            </p>
          </>
        ) : (
          <p className="mesa-npcard-empty">
            Aún no hay una canción reproduciéndose
          </p>
        )}
      </div>
    </div>
  );
}

function QueueTab({
  globalQueue,
  tableId,
  myQueueCount,
  effectiveLimit,
}: {
  globalQueue: QueueItem[];
  tableId: number;
  myQueueCount: number;
  effectiveLimit: number;
}) {
  return (
    <>
      <div className="mesa-list-head">
        <span className="mesa-list-head-count">
          {globalQueue.length} <span className="mesa-caption">en cola</span>
        </span>
        <span className="mesa-list-head-mine">
          Tu mesa:{" "}
          <strong>{myQueueCount}</strong>/{effectiveLimit}
        </span>
      </div>

      {globalQueue.length === 0 ? (
        <EmptyState
          icon="♪"
          title="COLA VACÍA"
          body="Sé el primero en poner una canción"
          variant="gold"
        />
      ) : (
        <ul className="mesa-list" role="list">
          {globalQueue.map((item, i) => (
            <QueueRow
              key={item.id}
              item={item}
              index={i}
              myTableId={tableId}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function QueueRow({
  item,
  index,
  myTableId,
}: {
  item: QueueItem;
  index: number;
  myTableId: number;
}) {
  const playing = item.status === "playing";
  const isMine = item.table_id === myTableId;

  return (
    <li className={`mesa-row ${playing ? "is-playing" : ""}`}>
      <div className={`mesa-row-num ${playing ? "is-playing" : ""} ${isMine ? "is-mine" : ""}`}>
        {playing ? "▶" : pad(index + 1)}
      </div>
      <div className="mesa-row-text">
        <div className="mesa-row-title">{item.song?.title ?? item.song_id}</div>
        <div className="mesa-row-meta">{secToMin(item.song?.duration ?? 0)}</div>
      </div>
      <div className="mesa-row-tags">
        {isMine && <span className="mesa-row-tag-mine">Tu mesa</span>}
        {playing && <span className="mesa-row-tag-now">Ahora</span>}
      </div>
    </li>
  );
}

function OrdersTab({
  requests,
  activeOrders,
  requestNumberById,
  orderNumberById,
  products,
  total,
  onOpenCart,
  onEditRequest,
  onOpenBill,
  onRequestUpdated,
  disableCreateOrder,
  paymentRequested,
  paid,
}: {
  requests: OrderRequest[];
  activeOrders: Order[];
  requestNumberById: Map<number, number>;
  orderNumberById: Map<number, number>;
  products: Product[];
  total: number;
  onOpenCart: () => void;
  onEditRequest: (r: OrderRequest) => void;
  onOpenBill: () => void;
  /**
   * Seeds the parent's `myRequests` after a customer-side mutation. We
   * call this with the OrderRequest the server returned (status updated
   * to e.g. "cancelled") so the row reflects the change instantly even
   * if the matching socket event is dropped — iOS Safari sometimes loses
   * the first event after joining a freshly-minted room. The eventual
   * socket arrival is harmless because `upsertById` upstream dedupes.
   */
  onRequestUpdated: (request: OrderRequest) => void;
  disableCreateOrder: boolean;
  paymentRequested: boolean;
  paid: boolean;
}) {
  // Per-row state for the customer's cancel action. Local because it
  // belongs to this view and dies with it; backend is the source of truth
  // and the socket update will remove the row regardless.
  const [busyRequestId, setBusyRequestId] = useState<number | null>(null);
  const [requestErrors, setRequestErrors] = useState<Record<number, string>>(
    {},
  );
  // Replaces window.confirm with an in-design confirmation. State holds the
  // request the user is about to cancel; null means no modal.
  const [confirmingCancel, setConfirmingCancel] = useState<OrderRequest | null>(
    null,
  );

  function requestCancelConfirmation(r: OrderRequest) {
    if (busyRequestId != null) return;
    setConfirmingCancel(r);
  }

  async function performCancel() {
    const r = confirmingCancel;
    if (!r) return;
    setConfirmingCancel(null);
    setBusyRequestId(r.id);
    setRequestErrors((prev) => {
      const next = { ...prev };
      delete next[r.id];
      return next;
    });
    try {
      const updated = await orderRequestsApi.cancel(r.id);
      // Seed the parent state immediately. The socket may also fire
      // `order-request:updated` shortly after; that's a harmless no-op
      // since the parent uses `upsertById`. Without this seed the row
      // stays as "pending" on screen and the user double-clicks cancel,
      // hitting ORDER_REQUEST_NOT_PENDING the second time.
      onRequestUpdated(updated);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      const msg =
        code === "ORDER_REQUEST_NOT_PENDING"
          ? "El bar ya aceptó tu pedido. Recarga para ver tu pedido."
          : ((err as { message?: string })?.message ??
            "No se pudo cancelar el pedido.");
      setRequestErrors((prev) => ({ ...prev, [r.id]: msg }));
    } finally {
      setBusyRequestId(null);
    }
  }
  // The customer-facing flow today is `accepted → delivered`; the
  // intermediate states still exist on the backend (kitchen-screen ready)
  // but never reach the customer screen, so we collapse them under the
  // same "Aceptado" label as a defensive default.
  const statusLabel: Record<Order["status"], string> = {
    accepted: "Aceptado",
    preparing: "Aceptado",
    ready: "Aceptado",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };

  // OrderRequest stores items as a JSON list of {product_id, quantity};
  // we resolve product names through the catalog snapshot the page loaded
  // at boot. Order rows already arrive with order_items.product hydrated.
  const productById = new Map<number, Product>();
  for (const p of products) productById.set(p.id, p);

  const itemsCount = (r: OrderRequest) =>
    Array.isArray(r.items)
      ? r.items.reduce((acc, it) => acc + (it.quantity ?? 0), 0)
      : 0;

  const empty = requests.length === 0 && activeOrders.length === 0 && total === 0;

  return (
    <div className="mesa-orders">
      {!empty && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          {paid ? (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2,
                color: C.olive,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              ● Pagada
            </span>
          ) : paymentRequested ? (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2,
                color: C.gold,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              ● Cuenta solicitada
            </span>
          ) : (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              — Tus pedidos
            </span>
          )}
          <button
            type="button"
            onClick={onOpenBill}
            style={{
              padding: "8px 14px",
              border: `1px solid ${C.cacao}`,
              background: C.paper,
              color: C.ink,
              borderRadius: 999,
              fontFamily: FONT_DISPLAY,
              fontSize: 12,
              letterSpacing: 2.5,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Ver factura
          </button>
        </div>
      )}

      {empty && (
        <>
          <EmptyState
            title="SIN PEDIDOS AÚN"
            body="Pide algo de la carta para empezar"
            variant="terracotta"
          />
          <div style={{ marginTop: 18, textAlign: "center" }}>
            <button
              type="button"
              onClick={onOpenCart}
              disabled={disableCreateOrder}
              style={{
                padding: "12px 22px",
                border: `1px solid ${disableCreateOrder ? C.sandDark : C.cacao}`,
                borderRadius: 999,
                background: disableCreateOrder ? C.parchment : C.paper,
                color: disableCreateOrder ? C.mute : C.ink,
                fontFamily: FONT_DISPLAY,
                fontSize: 14,
                letterSpacing: 3,
                cursor: disableCreateOrder ? "not-allowed" : "pointer",
                textTransform: "uppercase",
              }}
            >
              Pedir productos
            </button>
          </div>
        </>
      )}

      {requests.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <div className="mesa-caption" style={{ marginBottom: 10 }}>
            — En revisión
          </div>
          <ul className="mesa-list" role="list">
            {requests.map((r) => {
              const items = Array.isArray(r.items) ? r.items : [];
              return (
                <li
                  key={r.id}
                  className="mesa-row"
                  style={{
                    cursor: "default",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <div className="mesa-row-num">✎</div>
                  <div className="mesa-row-text" style={{ minWidth: 0 }}>
                    <div className="mesa-row-title">
                      Solicitud #{pad(requestNumberById.get(r.id) ?? 0)}
                    </div>
                    <div className="mesa-row-meta">
                      {itemsCount(r)}{" "}
                      {itemsCount(r) === 1 ? "unidad" : "unidades"} · esperando
                      al bar
                    </div>
                    {items.length > 0 && (
                      <ul
                        style={{
                          listStyle: "none",
                          margin: "8px 0 0",
                          padding: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        {items.map((it, idx) => {
                          const p = productById.get(it.product_id);
                          return (
                            <li
                              key={`${r.id}-${it.product_id}-${idx}`}
                              style={{
                                fontFamily: FONT_MONO,
                                fontSize: 11,
                                letterSpacing: 0.4,
                                color: C.cacao,
                              }}
                            >
                              <span
                                style={{ color: C.gold, fontWeight: 700 }}
                              >
                                {it.quantity}×
                              </span>{" "}
                              {p ? p.name : `Producto #${it.product_id}`}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onEditRequest(r)}
                        disabled={busyRequestId === r.id}
                        style={{
                          padding: "6px 12px",
                          border: `1px solid ${C.cacao}`,
                          background: C.paper,
                          color: C.ink,
                          borderRadius: 999,
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          letterSpacing: 1.5,
                          cursor:
                            busyRequestId === r.id ? "not-allowed" : "pointer",
                          textTransform: "uppercase",
                          fontWeight: 700,
                          opacity: busyRequestId === r.id ? 0.6 : 1,
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => requestCancelConfirmation(r)}
                        disabled={busyRequestId === r.id}
                        style={{
                          padding: "6px 12px",
                          border: `1px solid ${C.terracotta}`,
                          background: C.paper,
                          color: C.terracotta,
                          borderRadius: 999,
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          letterSpacing: 1.5,
                          cursor:
                            busyRequestId === r.id ? "not-allowed" : "pointer",
                          textTransform: "uppercase",
                          fontWeight: 700,
                          opacity: busyRequestId === r.id ? 0.6 : 1,
                        }}
                      >
                        {busyRequestId === r.id ? "Cancelando..." : "Cancelar"}
                      </button>
                    </div>

                    {requestErrors[r.id] && (
                      <p
                        role="alert"
                        style={{
                          margin: "8px 0 0",
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          letterSpacing: 1,
                          color: C.terracotta,
                          textTransform: "uppercase",
                        }}
                      >
                        {requestErrors[r.id]}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activeOrders.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <div className="mesa-caption" style={{ marginBottom: 10 }}>
            — En preparación
          </div>
          <ul className="mesa-list" role="list">
            {activeOrders.map((o) => {
              const items = o.order_items ?? [];
              const itemCount = items.reduce(
                (a, it) => a + (it.quantity ?? 0),
                0,
              );
              return (
                <li
                  key={o.id}
                  className="mesa-row"
                  style={{
                    cursor: "default",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <div className="mesa-row-text" style={{ minWidth: 0, flex: 1 }}>
                    <div className="mesa-row-title">
                      Pedido #{pad(orderNumberById.get(o.id) ?? 0)}
                    </div>
                    <div className="mesa-row-meta">
                      {itemCount} {itemCount === 1 ? "unidad" : "unidades"} ·{" "}
                      {statusLabel[o.status]}
                    </div>
                    {items.length > 0 && (
                      <ul
                        style={{
                          listStyle: "none",
                          margin: "8px 0 0",
                          padding: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        {items.map((it) => {
                          const name =
                            it.product?.name ??
                            productById.get(it.product_id)?.name ??
                            `Producto #${it.product_id}`;
                          return (
                            <li
                              key={it.id}
                              style={{
                                fontFamily: FONT_MONO,
                                fontSize: 11,
                                letterSpacing: 0.4,
                                color: C.cacao,
                              }}
                            >
                              <span
                                style={{ color: C.gold, fontWeight: 700 }}
                              >
                                {it.quantity}×
                              </span>{" "}
                              {name}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {total > 0 && (
        <div className="mesa-total-card">
          <span className="mesa-total-label">Total mesa</span>
          <span className="mesa-total-amount">{fmt(total)}</span>
        </div>
      )}

      {confirmingCancel && (
        <CancelConfirmModal
          request={confirmingCancel}
          requestNumber={requestNumberById.get(confirmingCancel.id) ?? null}
          productById={productById}
          onConfirm={performCancel}
          onClose={() => setConfirmingCancel(null)}
        />
      )}
    </div>
  );
}

// ─── Cancel-confirmation modal ───────────────────────────────────────────
// Replaces window.confirm so the dialog matches the rest of the mesa UI.
// Shows the items the customer is about to lose so they don't cancel by
// accident the wrong request when they have several pending.
function CancelConfirmModal({
  request,
  requestNumber,
  productById,
  onConfirm,
  onClose,
}: {
  request: OrderRequest;
  requestNumber: number | null;
  productById: Map<number, Product>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const items = Array.isArray(request.items) ? request.items : [];

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Cancelar pedido"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 380,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            — Cancelar
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "2px 0 0",
              textTransform: "uppercase",
            }}
          >
            Pedido {requestNumber != null ? `#${pad(requestNumber)}` : `#${request.id}`}
          </h3>
        </div>

        <p
          style={{
            margin: 0,
            fontFamily: FONT_UI,
            fontSize: 14,
            color: C.cacao,
            lineHeight: 1.45,
          }}
        >
          ¿Seguro que quieres cancelar este pedido? No podrás recuperarlo.
        </p>

        {items.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: "10px 12px",
              background: C.parchment,
              border: `1px solid ${C.sand}`,
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {items.map((it, idx) => {
              const p = productById.get(it.product_id);
              return (
                <li
                  key={`${request.id}-${it.product_id}-${idx}`}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    letterSpacing: 0.4,
                    color: C.ink,
                  }}
                >
                  <span style={{ color: C.gold, fontWeight: 700 }}>
                    {it.quantity}×
                  </span>{" "}
                  {p ? p.name : `Producto #${it.product_id}`}
                </li>
              );
            })}
          </ul>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 18px",
              border: `1px solid ${C.sand}`,
              background: "transparent",
              color: C.cacao,
              borderRadius: 999,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Volver
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: C.terracotta,
              color: C.paper,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 2.5,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Sí, cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  variant,
}: {
  icon?: string;
  title: string;
  body: string;
  variant: "gold" | "terracotta";
}) {
  return (
    <div className="mesa-empty">
      {icon && <div className={`mesa-empty-icon is-${variant}`}>{icon}</div>}
      <p className="mesa-empty-title">{title}</p>
      {body && <p className="mesa-empty-body">{body}</p>}
    </div>
  );
}

function RequestCTA({
  disabled,
  onClick,
  mobile,
  myQueueCount,
  effectiveLimit,
}: {
  disabled: boolean;
  onClick: () => void;
  mobile?: boolean;
  myQueueCount?: number;
  effectiveLimit?: number;
}) {
  const limit = effectiveLimit ?? MAX_SONGS_PER_TABLE;
  return (
    <button
      className={`mesa-cta ${mobile ? "is-mobile" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={
        disabled
          ? "Límite alcanzado"
          : mobile && typeof myQueueCount === "number"
            ? `Pedir canción, ${myQueueCount} de ${limit}`
            : "Pedir canción"
      }
    >
      <span className="mesa-cta-label">
        {disabled ? "LÍMITE ALCANZADO" : "PEDIR CANCIÓN"}
      </span>
      {/* On mobile we drop the decorative note so the count chip (which
          replaces it) doesn't have to share the cramped CTA width. On
          desktop the ornament stays because there is no count there. */}
      {!disabled && !mobile && (
        <span className="mesa-cta-ornament" aria-hidden>
          ♪
        </span>
      )}
      {mobile && !disabled && typeof myQueueCount === "number" && (
        <span className="mesa-cta-count" aria-hidden>
          {myQueueCount}/{limit}
        </span>
      )}
    </button>
  );
}

function OrderProductsCTA({
  onClick,
  mobile,
  disabled,
}: {
  onClick: () => void;
  mobile?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Pedir productos"
      style={{
        width: "100%",
        minWidth: 0,
        padding: mobile ? "14px 14px" : "16px 20px",
        border: `1px solid ${disabled ? C.sandDark : C.cacao}`,
        borderRadius: 999,
        background: disabled ? C.parchment : C.paper,
        color: disabled ? C.mute : C.ink,
        fontFamily: FONT_DISPLAY,
        fontSize: mobile ? 14 : 16,
        letterSpacing: mobile ? 1.5 : 3,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : C.shadow,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: mobile ? 8 : 10,
        textTransform: "uppercase",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        Pedir productos
      </span>
    </button>
  );
}

// ─── Bar access code gate ────────────────────────────────────────────────────
// Daily 4-digit code that the staff posts on the dashboard / player TV.
// Every device joining the table types it once. The code itself rotates
// every 24h (or on-demand from /admin), so a customer who screenshots
// the URL after their visit can't keep coming back next week.
function AccessCodeGate({
  tableNumber,
  onSuccess,
}: {
  tableNumber: number;
  onSuccess: (codeId: number) => void;
}) {
  const [digits, setDigits] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (digits.length !== 4 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await accessCodeApi.validate(digits);
      // Re-read the current id so the device pins to the right code,
      // even if the cashier rotated between us reading and validating.
      const current = await accessCodeApi.getForDisplay();
      onSuccess(current.id);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (code === "BAR_CODE_INVALID") {
        setError("Código incorrecto. Pídeselo al staff.");
      } else if (status === 429) {
        setError(
          "Demasiados intentos. Espera un momento e intenta de nuevo.",
        );
      } else {
        setError("No se pudo validar. Intenta de nuevo.");
      }
      setDigits("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: `radial-gradient(ellipse at 50% 0%, ${C.parchment} 0%, ${C.cream} 60%)`,
        color: C.ink,
        fontFamily: FONT_UI,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 18px",
      }}
    >
      <header style={{ textAlign: "center", paddingTop: 24 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="Crown Bar 4.90"
          style={{
            width: "min(48vw, 180px)",
            height: "auto",
            display: "block",
            margin: "0 auto",
            filter:
              "drop-shadow(0 6px 16px rgba(107,78,46,0.18)) drop-shadow(0 1px 2px rgba(43,29,20,0.12))",
          }}
        />
      </header>

      <form
        onSubmit={submit}
        style={{
          marginTop: 20,
          width: "100%",
          maxWidth: 380,
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 16,
          padding: "22px 22px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow:
            "0 1px 0 rgba(43,29,20,0.04), 0 22px 50px -32px rgba(107,78,46,0.4)",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 2.5,
              color: C.gold,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Mesa {String(tableNumber).padStart(2, "0")}
          </span>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              color: C.ink,
              letterSpacing: 2,
              margin: "4px 0 0",
              lineHeight: 1.05,
              textTransform: "uppercase",
            }}
          >
            Código del bar
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: C.cacao,
              fontFamily: FONT_UI,
              lineHeight: 1.45,
            }}
          >
            Escribe el código de 4 dígitos que verás en la pantalla del bar.
          </p>
        </div>

        <input
          type="text"
          inputMode="numeric"
          pattern="\d*"
          autoComplete="one-time-code"
          autoFocus
          value={digits}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(0, 4);
            setDigits(next);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && digits.length === 4) {
              void submit();
            }
          }}
          placeholder="••••"
          maxLength={4}
          aria-label="Código del bar de 4 dígitos"
          style={{
            padding: "14px 16px",
            border: `1px solid ${error ? C.terracotta : C.sand}`,
            borderRadius: 12,
            background: C.cream,
            color: C.ink,
            fontFamily: FONT_DISPLAY,
            fontSize: 28,
            letterSpacing: 12,
            textAlign: "center",
            outline: "none",
          }}
        />
        {error && (
          <span
            role="alert"
            style={{
              fontSize: 12,
              color: C.terracotta,
              fontFamily: FONT_UI,
              letterSpacing: 0.3,
              textAlign: "center",
            }}
          >
            {error}
          </span>
        )}

        <button
          type="submit"
          disabled={digits.length !== 4 || submitting}
          style={{
            padding: "13px 18px",
            border: "none",
            borderRadius: 999,
            background:
              digits.length !== 4 || submitting
                ? C.sand
                : `linear-gradient(135deg, ${C.olive} 0%, #7E8F58 100%)`,
            color: digits.length !== 4 || submitting ? C.mute : C.paper,
            fontFamily: FONT_DISPLAY,
            fontSize: 15,
            letterSpacing: 2.5,
            fontWeight: 600,
            cursor:
              digits.length !== 4 || submitting ? "not-allowed" : "pointer",
            textTransform: "uppercase",
          }}
        >
          {submitting ? "Validando..." : "Continuar"}
        </button>
      </form>
    </main>
  );
}

// ─── Table entry state ───────────────────────────────────────────────────────
// Rendered when there is no open session for this table. Explicit CTA calls
// POST /table-sessions/open; no auto-open to avoid spawning sessions from
// crawlers, link previews or double-renders.
function TableEntryView({
  table,
  onStart,
  loading,
  error,
}: {
  table: Table;
  onStart: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.cream,
        color: C.ink,
        fontFamily: FONT_UI,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        gap: 28,
        textAlign: "center",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 3,
          color: C.mute,
          textTransform: "uppercase",
        }}
      >
        — Bienvenido
      </span>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 4,
            color: C.cacao,
            textTransform: "uppercase",
          }}
        >
          Mesa
        </span>
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: "clamp(96px, 22vw, 180px)",
            lineHeight: 0.85,
            color: C.ink,
            letterSpacing: -6,
          }}
        >
          {pad(table.number ?? table.id)}
        </span>
      </div>

      <p
        style={{
          fontFamily: FONT_UI,
          fontSize: 16,
          color: C.cacao,
          maxWidth: 380,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        Toca abajo para empezar tu experiencia. Podrás pedir, elegir canciones
        y ver tu cuenta en vivo.
      </p>

      <div
        style={{
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onStart}
          disabled={loading}
          style={{
            width: "100%",
            padding: "18px 24px",
            border: "none",
            borderRadius: 999,
            background: loading
              ? C.sand
              : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
            color: loading ? C.mute : C.paper,
            fontFamily: FONT_DISPLAY,
            fontSize: 17,
            letterSpacing: 4,
            textTransform: "uppercase",
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: loading ? "none" : C.shadow,
          }}
        >
          {loading ? "Iniciando..." : "Empezar pedido"}
        </button>
        {error && (
          <p
            role="alert"
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.terracotta,
              letterSpacing: 1.5,
              margin: 0,
              textTransform: "uppercase",
            }}
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

// ─── Customer-side error card ────────────────────────────────────────────
// Reused for both "QR inválido" (missing table token) and "Sesión expirada"
// (server rejected our token mid-flight). No retry button on purpose: the
// recovery action is "scan the QR again", which the bar staff can also
// trigger by handing the customer the printed QR.
function CustomerErrorCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.cream,
        color: C.ink,
        fontFamily: FONT_UI,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        gap: 18,
        textAlign: "center",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 3,
          color: C.mute,
          textTransform: "uppercase",
        }}
      >
        {eyebrow}
      </span>
      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: "clamp(48px, 9vw, 76px)",
          letterSpacing: -1,
          color: C.terracotta,
          margin: 0,
          lineHeight: 1,
        }}
      >
        {title}
      </h1>
      <p
        style={{
          fontFamily: FONT_UI,
          fontSize: 15,
          color: C.cacao,
          maxWidth: 360,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {body}
      </p>
    </main>
  );
}

// ─── Styles (all responsive rules in a single styled block) ──────────────────
// ─── Toast stack (mesa) ───────────────────────────────────────────────────
// Visual cousin of the admin toast: top-center, prominent, colored by tone.
// Auto-dismiss is owned by the parent (push helper), this component is
// purely presentational.
function MesaToastStack({
  toasts,
}: {
  toasts: { id: number; tone: "olive" | "gold" | "cacao"; message: string }[];
}) {
  if (toasts.length === 0) return null;
  const palette: Record<
    "olive" | "gold" | "cacao",
    { border: string; iconBg: string; iconFg: string; icon: string }
  > = {
    olive: { border: C.olive, iconBg: C.oliveSoft, iconFg: C.olive, icon: "✓" },
    gold: { border: C.gold, iconBg: C.goldSoft, iconFg: C.cacao, icon: "★" },
    cacao: {
      border: C.cacao,
      iconBg: C.sand,
      iconFg: C.cacao,
      icon: "↺",
    },
  };
  return (
    <>
      <style>{`
        @keyframes mesa-toast-in {
          from { opacity: 0; transform: translateY(-12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          top: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 80,
          pointerEvents: "none",
          width: "calc(100% - 32px)",
          maxWidth: 520,
          alignItems: "center",
        }}
      >
        {toasts.map((t) => {
          const meta = palette[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              aria-live="assertive"
              style={{
                pointerEvents: "auto",
                background: C.ink,
                color: C.paper,
                padding: "16px 20px 16px 16px",
                borderRadius: 14,
                fontFamily: FONT_UI,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: 0.3,
                lineHeight: 1.35,
                width: "100%",
                boxShadow:
                  "0 18px 40px -12px rgba(43,29,20,0.55), 0 4px 12px -6px rgba(107,78,46,0.4)",
                borderLeft: `5px solid ${meta.border}`,
                display: "flex",
                alignItems: "center",
                gap: 12,
                animation:
                  "mesa-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: meta.iconBg,
                  color: meta.iconFg,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                {meta.icon}
              </span>
              <span style={{ minWidth: 0 }}>{t.message}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

const styles = `
  ${SHARED_KEYFRAMES}

  .mesa-root {
    ${THEME_CSS_VARS}

    min-height: 100dvh;
    width: 100%;
    background: var(--c-cream);
    color: var(--c-ink);
    font-family: ${FONT_UI};
    display: flex;
    flex-direction: column;
    position: relative;
    overflow-x: hidden;
  }

  /* Brand watermark — filigrana fija, dentro del panel principal */
  .mesa-main { position: relative; isolation: isolate; }
  .mesa-watermark {
    position: sticky;
    top: 0;
    height: 100dvh;
    margin-bottom: -100dvh;
    z-index: 0;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .mesa-watermark img {
    width: min(75vw, 420px);
    height: auto;
    opacity: 0.085;
    filter: sepia(0.55) saturate(1.3) hue-rotate(-8deg) brightness(0.85) contrast(1.05);
    mix-blend-mode: multiply;
    user-select: none;
    -webkit-user-drag: none;
    transform: translateY(-2%);
  }
  .mesa-main > :not(.mesa-watermark) { position: relative; z-index: 1; }

  .mesa-caption {
    font-family: ${FONT_MONO};
    font-size: 9px;
    letter-spacing: 3px;
    color: var(--c-mute);
    text-transform: uppercase;
    font-weight: 600;
  }

  /* ─── MOBILE FIRST ──────────────────────────────────────────────────────── */

  .mesa-sidebar,
  .mesa-rightpanel {
    display: none;
  }

  .mesa-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding-bottom: calc(104px + env(safe-area-inset-bottom));
  }

  .mesa-mobile-header {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px 10px;
    background: linear-gradient(180deg, var(--c-paper) 0%, var(--c-parchment) 100%);
    border-bottom: 1px solid var(--c-sand);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }

  .mesa-mobile-mesa-badge {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .mesa-mobile-mesa-label {
    font-family: ${FONT_MONO};
    font-size: 10px;
    letter-spacing: 3px;
    color: var(--c-mute);
    font-weight: 600;
  }
  .mesa-mobile-mesa-num {
    font-family: ${FONT_HEADING};
    font-size: 38px;
    letter-spacing: 0;
    color: var(--c-ink);
    line-height: 1;
  }

  .mesa-mobile-now {
    padding: 14px 18px 4px;
  }

  .mesa-tabs {
    display: flex;
    gap: 8px;
    padding: 14px 18px 10px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .mesa-tabs::-webkit-scrollbar { display: none; }

  .mesa-tab {
    flex: 0 0 auto;
    padding: 9px 16px;
    border: 1px solid var(--c-sand);
    background: var(--c-paper);
    color: var(--c-cacao);
    font-family: ${FONT_DISPLAY};
    font-size: 13px;
    letter-spacing: 2.5px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
    -webkit-tap-highlight-color: transparent;
    white-space: nowrap;
  }
  .mesa-tab:hover { color: var(--c-ink); border-color: var(--c-sand-dark); }
  .mesa-tab:focus-visible {
    outline: 2px solid var(--c-gold);
    outline-offset: 2px;
  }
  .mesa-tab.is-active {
    background: var(--c-ink);
    color: var(--c-paper);
    border-color: var(--c-ink);
  }
  .mesa-tab:active { transform: scale(0.97); }

  .mesa-tab-content {
    flex: 1;
    padding: 4px 18px 20px;
  }

  /* Status pill */
  .mesa-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--c-sand);
    background: var(--c-paper);
    font-family: ${FONT_MONO};
    font-size: 9px;
    letter-spacing: 2px;
    font-weight: 700;
    color: var(--c-mute);
    text-transform: uppercase;
  }
  .mesa-status-pill.is-playing {
    border-color: var(--c-gold-soft);
    background: color-mix(in srgb, var(--c-gold-soft) 40%, transparent);
    color: var(--c-gold);
  }
  .mesa-status-dot-wrap {
    position: relative;
    display: inline-flex;
    width: 8px;
    height: 8px;
  }
  .mesa-status-dot {
    position: relative;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .mesa-status-dot-ping {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: currentColor;
    opacity: 0;
  }
  .mesa-status-pill.is-playing .mesa-status-dot-ping {
    animation: crown-ping 2s ease-out infinite;
  }
  /* Equalizer bars inside the status pill (only shown when playing). */
  .mesa-eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 10px;
    margin-left: 2px;
  }
  .mesa-eq span {
    display: inline-block;
    width: 2px;
    height: 100%;
    background: currentColor;
    border-radius: 1px;
    transform-origin: bottom;
    will-change: transform;
  }
  .mesa-eq span:nth-child(1) { animation: crown-eq-1 0.9s ease-in-out infinite; }
  .mesa-eq span:nth-child(2) { animation: crown-eq-2 1.3s ease-in-out infinite; }
  .mesa-eq span:nth-child(3) { animation: crown-eq-3 1.1s ease-in-out infinite; }

  /* Now playing card */
  .mesa-npcard {
    position: relative;
    overflow: hidden;
    display: flex;
    gap: 14px;
    padding: 14px;
    border: 1px solid var(--c-sand);
    background: var(--c-paper);
    border-radius: 14px;
    box-shadow: ${C.shadow};
    align-items: center;
    transition: box-shadow 0.25s ease, transform 0.25s ease;
  }
  .mesa-npcard.is-live {
    background: linear-gradient(135deg, color-mix(in srgb, var(--c-gold-soft) 55%, var(--c-paper)) 0%, var(--c-paper) 60%);
    border-color: var(--c-gold-soft);
    box-shadow: 0 1px 0 rgba(43,29,20,0.04), 0 18px 40px -22px var(--c-gold);
  }
  /* Soft gold sweep skating across the card while playing. */
  .mesa-npcard-sweep {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    border-radius: inherit;
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  .mesa-npcard.is-live .mesa-npcard-sweep {
    opacity: 1;
  }
  .mesa-npcard-sweep::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 35%;
    height: 100%;
    background: linear-gradient(
      100deg,
      transparent 0%,
      color-mix(in srgb, var(--c-gold) 22%, transparent) 50%,
      transparent 100%
    );
    filter: blur(6px);
    transform: translateX(-120%);
    animation: crown-sweep 4.2s ease-in-out infinite;
  }
  .mesa-npcard-artwork {
    position: relative;
    flex: 0 0 auto;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 50%, var(--c-paper) 0%, var(--c-paper) 14%, transparent 14%),
      radial-gradient(circle at 50% 50%, var(--c-cacao) 16%, var(--c-ink) 18%, var(--c-cacao) 38%, var(--c-ink) 40%, var(--c-cacao) 60%, var(--c-ink) 62%, #1a0f08 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 20px -10px var(--c-cacao), inset 0 0 0 1px rgba(0,0,0,0.4);
  }
  .mesa-npcard.is-live .mesa-npcard-artwork {
    animation: crown-vinyl-spin 4s linear infinite;
  }
  /* Center label of the vinyl */
  .mesa-npcard-artwork::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--c-gold) 0%, var(--c-terracotta) 100%);
    transform: translate(-50%, -50%);
    box-shadow: inset 0 0 0 1px rgba(43,29,20,0.5);
  }
  .mesa-npcard-artwork-inner {
    position: relative;
    z-index: 1;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c-paper);
    box-shadow: 0 0 0 1px rgba(43,29,20,0.6);
  }
  .mesa-npcard-note {
    display: none;
  }
  .mesa-npcard-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mesa-npcard-eyebrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .mesa-live-tag {
    font-family: ${FONT_MONO};
    font-size: 8px;
    letter-spacing: 2px;
    color: var(--c-gold);
    font-weight: 700;
  }
  .mesa-npcard-title {
    font-family: ${FONT_DISPLAY};
    font-size: 20px;
    color: var(--c-ink);
    line-height: 1.15;
    letter-spacing: 0.4px;
    margin: 2px 0 0;
    white-space: nowrap;
    /* Soft fade on both edges so the marquee doesn't pop in/out hard. */
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
            mask-image: linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
  }
  .mesa-npcard-title-static {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mesa-npcard-meta {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: var(--c-cacao);
    letter-spacing: 1.5px;
    margin: 0;
  }
  .mesa-npcard-empty {
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: var(--c-mute);
    letter-spacing: 1.5px;
    margin: 2px 0 0;
    text-transform: uppercase;
  }

  /* List */
  .mesa-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0 10px;
    border-bottom: 1px solid var(--c-sand);
    margin-bottom: 4px;
  }
  .mesa-list-head-count {
    font-family: ${FONT_DISPLAY};
    font-size: 18px;
    color: var(--c-ink);
    letter-spacing: 1px;
  }
  .mesa-list-head-mine {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: var(--c-mute);
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }
  .mesa-list-head-mine strong {
    color: var(--c-gold);
    font-weight: 700;
  }

  .mesa-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .mesa-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 10px;
    margin: 0 -10px;
    border-radius: 10px;
    transition: background 0.2s ease;
    border-bottom: 1px solid var(--c-sand);
    cursor: default;
  }
  .mesa-row:last-child { border-bottom: none; }
  .mesa-row:hover { background: var(--c-parchment); }
  .mesa-row.is-playing {
    background: linear-gradient(90deg, color-mix(in srgb, var(--c-gold-soft) 60%, transparent) 0%, transparent 100%);
  }
  .mesa-row-num {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: transparent;
    font-family: ${FONT_DISPLAY};
    font-size: 15px;
    color: var(--c-mute);
    flex-shrink: 0;
  }
  .mesa-row-num.is-mine { background: var(--c-gold-soft); color: var(--c-cacao); }
  .mesa-row-num.is-playing { background: var(--c-gold); color: var(--c-paper); font-size: 16px; }
  .mesa-row-text {
    flex: 1;
    min-width: 0;
  }
  .mesa-row-title {
    font-family: ${FONT_DISPLAY};
    font-size: 15px;
    color: var(--c-ink);
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mesa-row-meta {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: var(--c-mute);
    margin-top: 3px;
    letter-spacing: 1px;
  }
  .mesa-row-tags {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }
  .mesa-row-tag-mine {
    font-family: ${FONT_MONO};
    font-size: 9px;
    letter-spacing: 1.5px;
    color: var(--c-gold);
    background: color-mix(in srgb, var(--c-gold-soft) 60%, transparent);
    border: 1px solid var(--c-gold-soft);
    padding: 3px 8px;
    border-radius: 999px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .mesa-row-tag-now {
    font-family: ${FONT_MONO};
    font-size: 9px;
    letter-spacing: 1.5px;
    color: var(--c-olive);
    font-weight: 700;
    text-transform: uppercase;
  }

  /* Empty state */
  .mesa-empty {
    text-align: center;
    padding: 56px 20px;
  }
  .mesa-empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    margin-bottom: 14px;
    font-family: ${FONT_DISPLAY};
    font-size: 24px;
  }
  .mesa-empty-icon.is-gold {
    background: color-mix(in srgb, var(--c-gold-soft) 70%, transparent);
    border: 1px solid var(--c-gold-soft);
    color: var(--c-gold);
  }
  .mesa-empty-icon.is-terracotta {
    background: color-mix(in srgb, var(--c-terracotta-soft) 70%, transparent);
    border: 1px solid var(--c-terracotta-soft);
    color: var(--c-terracotta);
  }
  .mesa-empty-title {
    font-family: ${FONT_DISPLAY};
    font-size: 16px;
    color: var(--c-cacao);
    letter-spacing: 2px;
    margin: 0;
  }
  .mesa-empty-body {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: var(--c-mute);
    letter-spacing: 2px;
    margin: 8px 0 0;
    text-transform: uppercase;
  }

  /* Orders */
  .mesa-orders { padding: 16px 0 8px; }
  .mesa-total-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px;
    margin-top: 12px;
    border: 1px solid var(--c-sand);
    background: var(--c-paper);
    border-radius: 12px;
    box-shadow: ${C.shadow};
  }
  .mesa-total-label {
    font-family: ${FONT_HEADING};
    font-size: 22px;
    color: var(--c-ink);
    letter-spacing: 0;
    line-height: 1;
  }
  .mesa-total-amount {
    font-family: ${FONT_HEADING};
    font-size: 30px;
    color: var(--c-gold);
    letter-spacing: 0;
    line-height: 1;
  }

  /* Mobile dock (sticky CTA) */
  .mesa-mobile-dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    padding: 12px 16px calc(14px + env(safe-area-inset-bottom));
    background: linear-gradient(180deg, rgba(253,248,236,0) 0%, var(--c-paper) 28%);
    pointer-events: none;
  }
  .mesa-mobile-dock > * { pointer-events: auto; }

  /* CTA button */
  .mesa-cta {
    width: 100%;
    padding: 16px 20px;
    border: none;
    border-radius: 999px;
    background: linear-gradient(135deg, var(--c-gold) 0%, #C9944F 100%);
    color: var(--c-paper);
    font-family: ${FONT_DISPLAY};
    font-size: 16px;
    letter-spacing: 3px;
    cursor: pointer;
    box-shadow: ${C.shadow};
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-transform: uppercase;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.18s ease, background 0.2s ease;
    will-change: transform;
    position: relative;
    min-width: 0;
  }
  /* On mobile the CTA shares its row with the products CTA, so the
     letter-spacing and padding are tightened and the label is allowed to
     truncate before the count chip gets pushed off the button. */
  .mesa-cta.is-mobile {
    padding: 14px 14px;
    font-size: 14px;
    letter-spacing: 1.5px;
    gap: 8px;
  }
  .mesa-cta.is-mobile .mesa-cta-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mesa-cta:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: ${C.shadowLift};
  }
  .mesa-cta:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
    background: var(--c-terracotta);
  }
  .mesa-cta:focus-visible {
    outline: 2px solid var(--c-ink);
    outline-offset: 3px;
  }
  .mesa-cta:disabled {
    background: var(--c-sand);
    color: var(--c-mute);
    cursor: not-allowed;
    box-shadow: none;
  }
  .mesa-cta-ornament {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(253,248,236,0.22);
    font-size: 13px;
  }
  .mesa-cta-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-family: ${FONT_MONO};
    font-size: 11px;
    letter-spacing: 1px;
    background: rgba(253,248,236,0.18);
    padding: 3px 8px;
    border-radius: 999px;
    line-height: 1;
  }
  .mesa-cta-hint {
    text-align: center;
    margin: 8px 0 0;
    font-size: 10px;
    color: var(--c-cacao);
    font-family: ${FONT_MONO};
    letter-spacing: 1px;
    line-height: 1.5;
  }

  /* Scoreboard (sidebar variant on desktop) */
  .mesa-scoreboard {
    position: relative;
    padding: 28px 26px 24px;
    background: linear-gradient(180deg, var(--c-paper) 0%, var(--c-parchment) 100%);
    border-radius: 20px;
    border: 1px solid var(--c-sand);
    box-shadow: ${C.shadow};
    overflow: hidden;
  }
  .mesa-scoreboard-decor {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.5;
    background:
      radial-gradient(circle at 15% 0%, rgba(184,137,74,0.1), transparent 55%),
      radial-gradient(circle at 90% 100%, rgba(197,90,60,0.08), transparent 50%);
  }
  .mesa-scoreboard-head {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
  }
  .mesa-scoreboard-number {
    position: relative;
    font-family: ${FONT_HEADING};
    font-size: clamp(96px, 13vw, 144px);
    line-height: 0.85;
    color: var(--c-ink);
    letter-spacing: 0;
    margin-bottom: 16px;
  }
  .mesa-scoreboard-consumo {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 22px;
  }
  .mesa-scoreboard-amount {
    font-family: ${FONT_HEADING};
    font-size: 36px;
    color: var(--c-gold);
    letter-spacing: 1px;
  }
  /* ─── DESKTOP (≥ 1024px) — 3-column full-bleed ─────────────────────────── */

  @media (min-width: 1024px) {
    .mesa-root {
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr) 380px;
      gap: 28px;
      padding: 28px;
      min-height: 100dvh;
      height: 100dvh;
      max-height: 100dvh;
      overflow: hidden;
      background:
        radial-gradient(ellipse at 10% 0%, rgba(184,137,74,0.07), transparent 55%),
        radial-gradient(ellipse at 95% 95%, rgba(197,90,60,0.05), transparent 50%),
        var(--c-cream);
    }

    .mesa-sidebar {
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .mesa-main {
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding-bottom: 0;
      background: var(--c-paper);
      border-radius: 20px;
      border: 1px solid var(--c-sand);
      box-shadow: ${C.shadow};
      overflow: hidden;
    }

    .mesa-mobile-header,
    .mesa-mobile-now,
    .mesa-mobile-dock {
      display: none !important;
    }

    .mesa-watermark img {
      width: min(45vw, 560px);
      opacity: 0.07;
    }

    .mesa-tabs {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 20px 28px 14px;
      background: var(--c-paper);
      border-bottom: 1px solid var(--c-sand);
      overflow-x: visible;
      gap: 6px;
    }
    .mesa-tab {
      border-radius: 999px;
      padding: 10px 20px;
      font-size: 14px;
      letter-spacing: 3px;
    }

    .mesa-tab-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px 28px 28px;
    }

    .mesa-rightpanel {
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
    }

    .mesa-rightpanel .mesa-npcard {
      flex-direction: column;
      align-items: flex-start;
      padding: 22px;
      gap: 18px;
    }
    .mesa-rightpanel .mesa-npcard-artwork {
      width: 100%;
      height: 220px;
      border-radius: 14px;
    }
    .mesa-rightpanel .mesa-npcard-artwork-inner {
      width: 90px;
      height: 90px;
    }
    .mesa-rightpanel .mesa-npcard-note {
      font-size: 52px;
    }
    .mesa-rightpanel .mesa-npcard-title {
      font-size: 28px;
      white-space: normal;
      overflow: visible;
      line-height: 1.1;
    }

    .mesa-rightpanel-cta-wrap {
      margin-top: auto;
      padding-top: 12px;
    }

    .mesa-cta {
      padding: 18px 22px;
      font-size: 17px;
      letter-spacing: 4px;
    }

    /* Scrollbars — subtle, warm */
    .mesa-sidebar::-webkit-scrollbar,
    .mesa-rightpanel::-webkit-scrollbar,
    .mesa-tab-content::-webkit-scrollbar {
      width: 6px;
    }
    .mesa-sidebar::-webkit-scrollbar-thumb,
    .mesa-rightpanel::-webkit-scrollbar-thumb,
    .mesa-tab-content::-webkit-scrollbar-thumb {
      background: var(--c-sand-dark);
      border-radius: 999px;
    }
  }

  /* XL — wider rails for huge monitors */
  @media (min-width: 1440px) {
    .mesa-root {
      grid-template-columns: 380px minmax(0, 1fr) 420px;
      gap: 32px;
      padding: 32px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mesa-cta, .mesa-row, .mesa-tab, .mesa-npcard {
      transition: none !important;
    }
    .mesa-status-dot-ping { animation: none !important; }
  }
`;
