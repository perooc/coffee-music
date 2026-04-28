"use client";

import { useEffect, use, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  useAppStore,
  selectCurrentPlayback,
  selectMyQueueCount,
} from "@/store";
import { useSocket } from "@/lib/socket/useSocket";
import {
  tablesApi,
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
  SCOREBOARD_MAX_CONSUMPTION,
  MAX_SONGS_PER_TABLE,
} from "@coffee-bar/shared";
import SongSearch from "@/components/music/SongSearch";
import { MySongsPanel } from "@/components/music/MySongsPanel";
import { OrderRequestCart } from "@/components/orders/OrderRequestCart";

// ─── Warm premium palette ─────────────────────────────────────────────────────
const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  terracotta: "#8B2635",
  terracottaSoft: "#E8CDD2",
  olive: "#6B7E4A",
  oliveSoft: "#E5EAD3",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
  paper: "#FFFDF8",
  shadow: "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
  shadowLift: "0 2px 0 rgba(43,29,20,0.05), 0 22px 40px -18px rgba(184,137,74,0.55)",
};

const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
const FONT_UI = "var(--font-manrope), system-ui, sans-serif";
const FONT_MONO = "var(--font-oswald), 'Oswald', ui-monospace, monospace";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

function buildMesaQueue(tableQueue: QueueItem[], tableId: number) {
  return tableQueue
    .filter((item) => item.table_id === tableId && item.status === "pending")
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
  // Session-scoped OrderRequests (mine). Catalog / cart stay separated.
  const [myRequests, setMyRequests] = useState<OrderRequest[]>([]);
  // Catalog: backend-owned, hydrated once. Cart inside modal is local-only.
  const [products, setProducts] = useState<Product[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

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
    setSession(null);
    setBill(null);
    setOrders([]);
    setMyRequests([]);
    setCartOpen(false);
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
  ]);

  const hydrateSessionData = useCallback(
    async (sessionToHydrate: TableSession) => {
      const [nextBill, nextOrders, nextRequests] = await Promise.all([
        billApi.getForSession(sessionToHydrate.id),
        ordersApi.getAllForSession(sessionToHydrate.id),
        orderRequestsApi.getAllForSession(sessionToHydrate.id),
      ]);

      setBill(nextBill);
      setOrders(dedupeById(nextOrders));
      setMyRequests(dedupeById(nextRequests));
    },
    [setOrders],
  );

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => {
      updateFromSocket(buildMesaQueue(q, tableId));
      setGlobalQueue(q);
      const prev = useAppStore.getState().mySongs;
      const history = prev.filter(
        (s) => s.status === "played" || s.status === "skipped",
      );
      const freshActive = q.filter((item) => item.table_id === tableId);
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

  // Initial load — table + session discovery + playback + queue.
  useEffect(() => {
    if (isNaN(tableId)) return;
    if (tableTokenStatus !== "ok") return;
    sessionStorage.setItem("table_id", String(tableId));
    tablesApi.getById(tableId).then(setCurrentTable).catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
    queueApi
      .getByTable(tableId)
      .then((tableQueue) => {
        updateFromSocket(buildMesaQueue(tableQueue, tableId));
      })
      .catch(console.error);
    queueApi
      .getByTableWithHistory(tableId)
      .then((songs) => setMySongs(dedupeById(songs)))
      .catch(console.error);
    queueApi.getGlobal().then(setGlobalQueue).catch(console.error);
    productsApi.getAll().then(setProducts).catch(console.error);

    tableSessionsApi
      .getCurrentForTable(tableId)
      .then((s) => setSession(s))
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        // 401/403 from a customer-side endpoint = the token is no longer
        // accepted. We surface the recovery card; the user will scan again.
        if (status === 401 || status === 403) {
          setSessionInvalid(true);
          return;
        }
        console.error(err);
        setSession(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, tableTokenStatus]);

  // When a session is known, fetch session-scoped data (bill + orders + requests).
  useEffect(() => {
    if (!session) {
      setBill(null);
      setOrders([]);
      setMyRequests([]);
      return;
    }
    hydrateSessionData(session).catch((err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 401 || status === 403) {
        // Session token expired or revoked while we had a live session.
        // Surface the recovery card; user must scan the QR again.
        setSessionInvalid(true);
        return;
      }
      console.error(err);
    });
  }, [session, setOrders, hydrateSessionData]);

  async function handleStartSession() {
    setOpenError(null);
    setOpeningSession(true);
    try {
      const created = await tableSessionsApi.open(tableId);
      // Persist the session token BEFORE marking the session as live so that
      // - subsequent customerApi requests carry the bearer
      // - the socket's auth callback (re-)resolves to a session token and
      //   auto-joins tableSession:{id} on reconnect.
      setSessionToken(created.session_token);
      const { session_token: _ignored, ...session } = created;
      void _ignored;
      setSession(session);
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

  const disabled = myQueueCount >= MAX_SONGS_PER_TABLE;
  const orderCreationDisabled = session?.status === "closed";

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
                total={billTotal}
                onOpenCart={() => setCartOpen(true)}
                disableCreateOrder={orderCreationDisabled}
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
              onClick={() => setCartOpen(true)}
              disabled={orderCreationDisabled}
            />
            <div style={{ height: 10 }} />
            <RequestCTA
              disabled={disabled}
              onClick={() => setSearchOpen(true)}
            />
            {disabled && (
              <p className="mesa-cta-hint">
                Espera 15 min o consume $20 mil más para agregar otra canción
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
              onClick={() => setCartOpen(true)}
              mobile
              disabled={orderCreationDisabled}
            />
            <RequestCTA
              disabled={disabled}
              onClick={() => setSearchOpen(true)}
              mobile
              myQueueCount={myQueueCount}
            />
          </div>
          {disabled && (
            <p className="mesa-cta-hint">
              Espera 15 min o consume $20 mil más
            </p>
          )}
        </div>

        <SongSearch
          tableId={tableId}
          open={isSearchOpen}
          onClose={() => setSearchOpen(false)}
          onAdded={() => {
            queueApi
              .getByTable(tableId)
              .then((tableQueue) => {
                updateFromSocket(buildMesaQueue(tableQueue, tableId));
              })
              .catch(console.error);
            queueApi
              .getByTableWithHistory(tableId)
              .then(setMySongs)
              .catch(console.error);
          }}
          myQueue={queue}
          globalQueue={globalQueue}
        />

        <OrderRequestCart
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          onSubmitted={() => {
            /* request enters via socket; nothing to refetch here */
          }}
          tableSessionId={session.id}
          products={products}
        />
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
  const MAX = SCOREBOARD_MAX_CONSUMPTION;
  const pct = Math.min(100, Math.round((table.total_consumption / MAX) * 100));

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

      <div className="mesa-progress-wrap">
        <div className="mesa-progress-labels">
          <span className="mesa-caption">Nivel de mesa</span>
          <span className="mesa-progress-pct">{pct}%</span>
        </div>
        <div className="mesa-progress-track">
          <div
            className="mesa-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
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
      <div className="mesa-npcard-artwork" aria-hidden>
        <div className="mesa-npcard-artwork-inner">
          <span className="mesa-npcard-note">♪</span>
        </div>
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
            <h3 className="mesa-npcard-title">{playback.song?.title}</h3>
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
}: {
  globalQueue: QueueItem[];
  tableId: number;
  myQueueCount: number;
}) {
  return (
    <>
      <div className="mesa-list-head">
        <span className="mesa-list-head-count">
          {globalQueue.length} <span className="mesa-caption">en cola</span>
        </span>
        <span className="mesa-list-head-mine">
          Tu mesa:{" "}
          <strong>{myQueueCount}</strong>/{MAX_SONGS_PER_TABLE}
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
  total,
  onOpenCart,
  disableCreateOrder,
}: {
  requests: OrderRequest[];
  activeOrders: Order[];
  total: number;
  onOpenCart: () => void;
  disableCreateOrder: boolean;
}) {
  const statusLabel: Record<Order["status"], string> = {
    accepted: "Aceptado",
    preparing: "Preparando",
    ready: "Listo",
    delivered: "Entregado",
    cancelled: "Cancelado",
  };

  const itemsCount = (r: OrderRequest) =>
    Array.isArray(r.items)
      ? r.items.reduce((acc, it) => acc + (it.quantity ?? 0), 0)
      : 0;

  const empty = requests.length === 0 && activeOrders.length === 0 && total === 0;

  return (
    <div className="mesa-orders">
      {empty && (
        <>
          <EmptyState
            icon="☕"
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
            {requests.map((r) => (
              <li
                key={r.id}
                className="mesa-row"
                style={{ cursor: "default" }}
              >
                <div className="mesa-row-num">✎</div>
                <div className="mesa-row-text">
                  <div className="mesa-row-title">
                    Solicitud #{r.id}
                  </div>
                  <div className="mesa-row-meta">
                    {itemsCount(r)}{" "}
                    {itemsCount(r) === 1 ? "unidad" : "unidades"} · esperando
                    al bar
                  </div>
                </div>
              </li>
            ))}
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
              const itemCount = (o.order_items ?? []).reduce(
                (a, it) => a + (it.quantity ?? 0),
                0,
              );
              return (
                <li
                  key={o.id}
                  className="mesa-row"
                  style={{ cursor: "default" }}
                >
                  <div className="mesa-row-num">☕</div>
                  <div className="mesa-row-text">
                    <div className="mesa-row-title">Pedido #{o.id}</div>
                    <div className="mesa-row-meta">
                      {itemCount} {itemCount === 1 ? "unidad" : "unidades"} ·{" "}
                      {statusLabel[o.status]}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {total > 0 && (
        <div className="mesa-total-card">
          <span className="mesa-caption">Total mesa</span>
          <span className="mesa-total-amount">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  variant,
}: {
  icon: string;
  title: string;
  body: string;
  variant: "gold" | "terracotta";
}) {
  return (
    <div className="mesa-empty">
      <div className={`mesa-empty-icon is-${variant}`}>{icon}</div>
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
}: {
  disabled: boolean;
  onClick: () => void;
  mobile?: boolean;
  myQueueCount?: number;
}) {
  return (
    <button
      className={`mesa-cta ${mobile ? "is-mobile" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={disabled ? "Límite alcanzado" : "Pedir canción"}
    >
      <span className="mesa-cta-label">
        {disabled ? "LÍMITE ALCANZADO" : "PEDIR CANCIÓN"}
      </span>
      {!disabled && (
        <span className="mesa-cta-ornament" aria-hidden>
          ♪
        </span>
      )}
      {mobile && !disabled && typeof myQueueCount === "number" && (
        <span className="mesa-cta-count" aria-hidden>
          {myQueueCount}/{MAX_SONGS_PER_TABLE}
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
        padding: mobile ? "14px 16px" : "16px 20px",
        border: `1px solid ${disabled ? C.sandDark : C.cacao}`,
        borderRadius: 999,
        background: disabled ? C.parchment : C.paper,
        color: disabled ? C.mute : C.ink,
        fontFamily: FONT_DISPLAY,
        fontSize: mobile ? 14 : 16,
        letterSpacing: 3,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : C.shadow,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        textTransform: "uppercase",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span>Pedir productos</span>
      <span aria-hidden>☕</span>
    </button>
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
const styles = `
  @keyframes crown-ping {
    0%   { transform: scale(1);   opacity: 0.55; }
    80%  { transform: scale(2.6); opacity: 0;    }
    100% { transform: scale(2.6); opacity: 0;    }
  }
  @keyframes crown-tab-in {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }

  .mesa-root {
    --c-cream: ${C.cream};
    --c-parchment: ${C.parchment};
    --c-sand: ${C.sand};
    --c-sand-dark: ${C.sandDark};
    --c-gold: ${C.gold};
    --c-gold-soft: ${C.goldSoft};
    --c-terracotta: ${C.terracotta};
    --c-terracotta-soft: ${C.terracottaSoft};
    --c-olive: ${C.olive};
    --c-olive-soft: ${C.oliveSoft};
    --c-cacao: ${C.cacao};
    --c-ink: ${C.ink};
    --c-mute: ${C.mute};
    --c-paper: ${C.paper};

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
    font-family: ${FONT_DISPLAY};
    font-size: 34px;
    letter-spacing: -1px;
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
    border-color: var(--c-olive-soft);
    background: color-mix(in srgb, var(--c-olive-soft) 40%, transparent);
    color: var(--c-olive);
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

  /* Now playing card */
  .mesa-npcard {
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
    background: linear-gradient(135deg, color-mix(in srgb, var(--c-olive-soft) 55%, var(--c-paper)) 0%, var(--c-paper) 60%);
    border-color: var(--c-olive-soft);
  }
  .mesa-npcard-artwork {
    flex: 0 0 auto;
    width: 64px;
    height: 64px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--c-gold) 0%, var(--c-terracotta) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 20px -10px var(--c-gold);
  }
  .mesa-npcard-artwork-inner {
    width: 46px;
    height: 46px;
    border-radius: 8px;
    background: rgba(253,248,236,0.18);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mesa-npcard-note {
    font-family: ${FONT_DISPLAY};
    font-size: 26px;
    color: var(--c-paper);
    line-height: 1;
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
    color: var(--c-olive);
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
    background: linear-gradient(90deg, color-mix(in srgb, var(--c-olive-soft) 60%, transparent) 0%, transparent 100%);
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
  .mesa-row-num.is-playing { background: var(--c-olive); color: var(--c-paper); font-size: 16px; }
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
  .mesa-total-amount {
    font-family: ${FONT_DISPLAY};
    font-size: 26px;
    color: var(--c-gold);
    letter-spacing: 1px;
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
    position: absolute;
    right: 16px;
    font-family: ${FONT_MONO};
    font-size: 11px;
    letter-spacing: 1px;
    background: rgba(253,248,236,0.18);
    padding: 3px 8px;
    border-radius: 999px;
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
    font-family: ${FONT_DISPLAY};
    font-size: clamp(88px, 12vw, 128px);
    line-height: 0.85;
    color: var(--c-ink);
    letter-spacing: -5px;
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
    font-family: ${FONT_DISPLAY};
    font-size: 30px;
    color: var(--c-gold);
    letter-spacing: 1px;
  }
  .mesa-progress-wrap { position: relative; }
  .mesa-progress-labels {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .mesa-progress-pct {
    font-family: ${FONT_MONO};
    font-size: 10px;
    color: var(--c-gold);
    font-weight: 700;
    letter-spacing: 1px;
  }
  .mesa-progress-track {
    height: 6px;
    background: var(--c-sand);
    overflow: hidden;
    border-radius: 999px;
    box-shadow: inset 0 1px 2px rgba(43,29,20,0.08);
  }
  .mesa-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--c-gold) 0%, var(--c-terracotta) 100%);
    transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    border-radius: 999px;
    box-shadow: 0 0 12px rgba(184,137,74,0.4);
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
    .mesa-cta, .mesa-row, .mesa-tab, .mesa-progress-fill, .mesa-npcard {
      transition: none !important;
    }
    .mesa-status-dot-ping { animation: none !important; }
  }
`;
