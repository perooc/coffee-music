"use client";

import Link from "next/link";
import { useEffect, useCallback, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { useSocket } from "@/lib/socket/useSocket";
import {
  tablesApi,
  queueApi,
  ordersApi,
  orderRequestsApi,
  playbackApi,
  musicApi,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { useAdminAuth } from "@/lib/auth/auth-context";
import { AdminBillDrawer } from "@/components/admin/AdminBillDrawer";
import type {
  Order,
  OrderRequest,
  PlaybackState,
  QueueItem,
  Table,
  YouTubeSearchResult,
} from "@coffee-bar/shared";

// ─── Warm premium palette ─────────────────────────────────────────────────────
const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  burgundy: "#8B2635",
  burgundySoft: "#E8CDD2",
  olive: "#6B7E4A",
  oliveSoft: "#E5EAD3",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
  paper: "#FFFDF8",
  shadow: "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
  shadowLift: "0 2px 0 rgba(43,29,20,0.05), 0 22px 40px -18px rgba(184,137,74,0.55)",
  shadowModal: "0 30px 80px -20px rgba(43,29,20,0.45), 0 10px 32px -12px rgba(107,78,46,0.35)",
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

// Map existing statuses to our warm palette
const statusColor: Record<string, string> = {
  available: C.gold,
  active: C.olive,
  inactive: C.mute,
  occupied: C.burgundy,
  pending: C.gold,
  preparing: C.burgundy,
  ready: C.olive,
  delivered: C.olive,
  cancelled: C.burgundy,
  played: C.mute,
  skipped: C.burgundy,
};

function Badge({ label, status }: { label: string; status: string }) {
  const color = statusColor[status] ?? C.mute;
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: FONT_MONO,
        letterSpacing: 1.5,
        color,
        border: `1px solid ${color}55`,
        background: `${color}14`,
        padding: "3px 9px",
        borderRadius: 999,
        fontWeight: 700,
        textTransform: "uppercase",
      }}
    >
      {label.toUpperCase()}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

function fmtTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Admin Search Modal ──────────────────────────────────────────────────────
function AdminSearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const search = async (q: string) => {
    if (q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const data = await musicApi.search(q);
      setResults(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 400);
  };

  const handlePlayNow = async (r: YouTubeSearchResult) => {
    setAdding(`now:${r.youtubeId}`);
    setError(null);
    try {
      await queueApi.adminPlayNow({
        youtube_id: r.youtubeId,
        title: r.title,
        duration: r.duration,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAdding(null);
    }
  };

  const handleAddToQueue = async (r: YouTubeSearchResult, position?: number) => {
    setAdding(`queue:${r.youtubeId}`);
    setError(null);
    try {
      await queueApi.adminCreate({
        youtube_id: r.youtubeId,
        title: r.title,
        duration: r.duration,
        position,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAdding(null);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: `
          radial-gradient(ellipse at 30% 20%, rgba(184,137,74,0.15), transparent 60%),
          radial-gradient(ellipse at 80% 80%, rgba(139,38,53,0.12), transparent 55%),
          rgba(43,29,20,0.55)
        `,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_UI,
          color: C.ink,
          background: `linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%)`,
          border: `1px solid ${C.sand}`,
          borderRadius: 20,
          boxShadow: C.shadowModal,
          width: "100%",
          maxWidth: 640,
          maxHeight: "min(680px, calc(100dvh - 32px))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 22px 16px",
            borderBottom: `1px solid ${C.sand}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 3,
                color: C.mute,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              — Admin
            </div>
            <h2
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 24,
                letterSpacing: 3,
                color: C.ink,
                margin: "6px 0 4px",
                lineHeight: 1,
              }}
            >
              AGREGAR CANCIÓN
            </h2>
            <p
              style={{
                fontSize: 11,
                color: C.cacao,
                fontFamily: FONT_MONO,
                letterSpacing: 1,
                margin: 0,
              }}
            >
              Sin restricciones de duración o límite
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: C.paper,
              border: `1px solid ${C.sand}`,
              color: C.cacao,
              width: 34,
              height: 34,
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              borderRadius: 10,
              fontFamily: FONT_UI,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "14px 22px 4px" }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Buscar cualquier canción..."
            style={{
              width: "100%",
              padding: "13px 14px",
              background: C.paper,
              border: `1px solid ${C.sand}`,
              color: C.ink,
              fontFamily: FONT_UI,
              fontSize: 14,
              outline: "none",
              borderRadius: 12,
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              margin: "10px 22px 0",
              padding: "10px 12px",
              background: C.burgundySoft,
              border: `1px solid ${C.burgundy}`,
              color: C.burgundy,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 1,
              borderRadius: 10,
            }}
          >
            {error}
          </div>
        )}

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 22px 20px", minHeight: 0 }}>
          {loading && (
            <p style={{ textAlign: "center", padding: 24, color: C.mute, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase" }}>
              Buscando...
            </p>
          )}

          {!loading && !error && query.length >= 2 && results.length === 0 && (
            <p style={{ textAlign: "center", padding: 24, color: C.mute, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase" }}>
              Sin resultados
            </p>
          )}

          {results.map((r) => {
            const isAdding = adding?.includes(r.youtubeId) ?? false;
            return (
              <div
                key={r.youtubeId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 10px",
                  margin: "0 -10px",
                  borderRadius: 10,
                  borderBottom: `1px solid ${C.sand}`,
                }}
              >
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.thumbnail}
                    alt=""
                    style={{ width: 56, height: 42, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{
                      width: 56,
                      height: 42,
                      borderRadius: 8,
                      background: `linear-gradient(135deg, ${C.goldSoft} 0%, ${C.burgundySoft} 100%)`,
                      color: C.gold,
                      fontFamily: FONT_DISPLAY,
                      fontSize: 18,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    ♪
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 14,
                      color: C.ink,
                      letterSpacing: 0.3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      lineHeight: 1.2,
                    }}
                  >
                    {r.title}
                  </div>
                  <div style={{ fontSize: 10, color: C.mute, fontFamily: FONT_MONO, marginTop: 3, letterSpacing: 1 }}>
                    {secToMin(r.duration)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => handlePlayNow(r)}
                    disabled={isAdding}
                    style={{
                      padding: "7px 11px",
                      background: isAdding ? C.sand : C.burgundy,
                      border: "none",
                      color: isAdding ? C.mute : C.paper,
                      fontFamily: FONT_DISPLAY,
                      fontSize: 11,
                      letterSpacing: 1.5,
                      cursor: isAdding ? "not-allowed" : "pointer",
                      borderRadius: 999,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    SONAR YA
                  </button>
                  <button
                    onClick={() => handleAddToQueue(r, 1)}
                    disabled={isAdding}
                    style={{
                      padding: "7px 11px",
                      background: isAdding
                        ? C.sand
                        : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
                      border: "none",
                      color: isAdding ? C.mute : C.paper,
                      fontFamily: FONT_DISPLAY,
                      fontSize: 11,
                      letterSpacing: 1.5,
                      cursor: isAdding ? "not-allowed" : "pointer",
                      borderRadius: 999,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    SIGUIENTE
                  </button>
                  <button
                    onClick={() => handleAddToQueue(r)}
                    disabled={isAdding}
                    style={{
                      padding: "7px 11px",
                      background: "transparent",
                      border: `1px solid ${C.sand}`,
                      color: isAdding ? C.mute : C.cacao,
                      fontFamily: FONT_DISPLAY,
                      fontSize: 11,
                      letterSpacing: 1.5,
                      cursor: isAdding ? "not-allowed" : "pointer",
                      borderRadius: 999,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    AL FINAL
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Columna mesas ────────────────────────────────────────────────────────────
function TablesColumn({
  tables,
  onOpenBill,
}: {
  tables: Table[];
  onOpenBill: (sessionId: number, tableNumber: number | null) => void;
}) {
  // Sort priority: pending attention > operating > closing > available.
  // Within the top band, pending requests break the tie so staff see them first.
  const statusRank: Record<string, number> = {
    occupied: 0,
    closing: 1,
    available: 2,
  };
  const sortedTables = [...tables].sort((a, b) => {
    const aAttention =
      a.pending_request_count > 0 || a.active_order_count > 0 ? 0 : 1;
    const bAttention =
      b.pending_request_count > 0 || b.active_order_count > 0 ? 0 : 1;
    if (aAttention !== bAttention) return aAttention - bAttention;
    const rs = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rs !== 0) return rs;
    if (b.pending_request_count !== a.pending_request_count) {
      return b.pending_request_count - a.pending_request_count;
    }
    return (a.number ?? a.id) - (b.number ?? b.id);
  });

  return (
    <div
      style={{
        flex: 1,
        minWidth: 220,
        borderRight: `1px solid ${C.sand}`,
        overflowY: "auto",
        background: C.paper,
      }}
    >
      <ColumnHeader label="Mesas" count={tables.length} />
      {sortedTables.map((t) => {
        const isAvailable = t.status === "available";
        const needsAttention = t.pending_request_count > 0;
        return (
        <div
          key={t.id}
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${C.sand}`,
            borderLeft: needsAttention
              ? `3px solid ${C.burgundy}`
              : "3px solid transparent",
            background: needsAttention
              ? `color-mix(in srgb, ${C.burgundySoft} 25%, transparent)`
              : "transparent",
            opacity: isAvailable ? 0.7 : 1,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: isAvailable ? 0 : 8,
            }}
          >
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: isAvailable ? 20 : 24,
                color: isAvailable ? C.mute : C.ink,
                letterSpacing: -0.5,
              }}
            >
              {pad(t.number ?? t.id)}
            </span>
            <Badge label={t.status} status={t.status} />
          </div>
          {!isAvailable && (
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 16,
              color: C.gold,
              letterSpacing: 0.5,
            }}
          >
            {fmt(t.total_consumption)}
          </div>
          )}
          {(t.pending_request_count > 0 || t.active_order_count > 0) && (
            <div
              style={{
                display: "flex",
                gap: 6,
                marginTop: 8,
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              {t.pending_request_count > 0 && (
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: C.burgundySoft,
                    color: C.burgundy,
                    fontWeight: 700,
                  }}
                >
                  {t.pending_request_count} solicitud
                  {t.pending_request_count === 1 ? "" : "es"}
                </span>
              )}
              {t.active_order_count > 0 && (
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: C.goldSoft,
                    color: C.cacao,
                    fontWeight: 700,
                  }}
                >
                  {t.active_order_count} pedido
                  {t.active_order_count === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
          {t.current_session_id != null && (
            <button
              type="button"
              onClick={() =>
                onOpenBill(t.current_session_id!, t.number ?? t.id)
              }
              style={{
                marginTop: 10,
                padding: "6px 12px",
                border: `1px solid ${C.sand}`,
                background: C.paper,
                color: C.cacao,
                borderRadius: 999,
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1.5,
                cursor: "pointer",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              Ver cuenta
            </button>
          )}
        </div>
        );
      })}
      {tables.length === 0 && <EmptyMsg text="Sin mesas" />}
    </div>
  );
}

// ─── Columna cola ─────────────────────────────────────────────────────────────
function QueueColumn({ queue }: { queue: QueueItem[] }) {
  const skip = async (id: number) => {
    await queueApi.skip(id);
  };

  return (
    <div
      style={{
        flex: 1.4,
        minWidth: 260,
        borderRight: `1px solid ${C.sand}`,
        overflowY: "auto",
        background: C.paper,
      }}
    >
      <ColumnHeader label="Cola global" count={queue.length} />
      {queue.map((item, i) => {
        const playing = item.status === "playing";
        return (
          <div
            key={item.id}
            title={`Agregada: ${fmtTime(item.queued_at)}${item.started_playing_at ? ` · Inició: ${fmtTime(item.started_playing_at)}` : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 18px",
              borderBottom: `1px solid ${C.sand}`,
              background: playing
                ? `linear-gradient(90deg, color-mix(in srgb, ${C.oliveSoft} 60%, transparent) 0%, transparent 100%)`
                : "transparent",
            }}
          >
            <span
              style={{
                width: 28,
                minWidth: 28,
                height: 28,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONT_DISPLAY,
                fontSize: playing ? 15 : 13,
                color: playing ? C.paper : C.mute,
                background: playing ? C.olive : "transparent",
              }}
            >
              {playing ? "▶" : pad(i + 1)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 13,
                  color: playing ? C.ink : C.cacao,
                  letterSpacing: 0.3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.song?.title ?? `Song #${item.song_id}`}
              </div>
              <div style={{ fontSize: 10, color: C.mute, fontFamily: FONT_MONO, marginTop: 3, letterSpacing: 0.8 }}>
                {item.table_id ? `Mesa ${pad(item.table_id)}` : "ADMIN"} · pos. {item.position} ·{" "}
                {playing && item.started_playing_at
                  ? `sonando ${timeAgo(item.started_playing_at)}`
                  : `en cola ${timeAgo(item.created_at)}`}
              </div>
            </div>
            {!playing && (
              <button
                onClick={() => skip(item.id)}
                style={{
                  background: "transparent",
                  border: `1px solid ${C.sand}`,
                  color: C.cacao,
                  padding: "4px 10px",
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 1,
                  cursor: "pointer",
                  borderRadius: 999,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                Skip
              </button>
            )}
          </div>
        );
      })}
      {queue.length === 0 && <EmptyMsg text="Cola vacía" />}
    </div>
  );
}

// ─── Columna solicitudes pendientes ──────────────────────────────────────────
// Why: customers create OrderRequests that need explicit staff review before
// stock is decremented. This column is the single place where accept/reject
// happens — without it, no customer request can ever become an Order.
function PendingRequestsColumn({
  requests,
  tables,
}: {
  requests: OrderRequest[];
  tables: Table[];
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errorByRequest, setErrorByRequest] = useState<Record<number, string>>(
    {},
  );

  const tableNumberBySessionId = new Map<number, number>();
  for (const t of tables) {
    if (t.current_session_id != null) {
      tableNumberBySessionId.set(t.current_session_id, t.number ?? t.id);
    }
  }

  const run = async (id: number, action: "accept" | "reject") => {
    setBusyId(id);
    setErrorByRequest((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      if (action === "accept") {
        await orderRequestsApi.accept(id);
      } else {
        await orderRequestsApi.reject(id);
      }
    } catch (err) {
      setErrorByRequest((prev) => ({ ...prev, [id]: getErrorMessage(err) }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      style={{
        flex: 1.2,
        minWidth: 260,
        overflowY: "auto",
        background: C.paper,
        borderLeft: `1px solid ${C.sand}`,
      }}
    >
      <ColumnHeader label="Solicitudes" count={requests.length} />
      {requests.map((r) => {
        const tableNumber =
          tableNumberBySessionId.get(r.table_session_id) ??
          r.table_session?.table_id;
        const itemsCount = Array.isArray(r.items)
          ? r.items.reduce((acc, it) => acc + (it.quantity ?? 0), 0)
          : 0;
        const busy = busyId === r.id;
        return (
          <div
            key={r.id}
            style={{
              padding: "14px 18px",
              borderBottom: `1px solid ${C.sand}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 16,
                    color: C.ink,
                    letterSpacing: 0.5,
                  }}
                >
                  {tableNumber != null
                    ? `Mesa ${pad(tableNumber)}`
                    : `Sesión ${r.table_session_id}`}
                </span>
                <Badge label={r.status} status={r.status} />
              </div>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.mute,
                  letterSpacing: 1,
                }}
              >
                {itemsCount} {itemsCount === 1 ? "unidad" : "unidades"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => run(r.id, "accept")}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  background: busy
                    ? C.sand
                    : `color-mix(in srgb, ${C.oliveSoft} 50%, transparent)`,
                  border: `1px solid ${busy ? C.sand : C.olive}`,
                  color: busy ? C.mute : C.olive,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 11,
                  letterSpacing: 2.5,
                  cursor: busy ? "not-allowed" : "pointer",
                  borderRadius: 999,
                  fontWeight: 600,
                }}
              >
                ACEPTAR
              </button>
              <button
                onClick={() => run(r.id, "reject")}
                disabled={busy}
                style={{
                  padding: "8px 12px",
                  background: C.burgundySoft,
                  border: `1px solid ${C.burgundy}`,
                  color: C.burgundy,
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                  cursor: busy ? "not-allowed" : "pointer",
                  borderRadius: 999,
                  fontWeight: 700,
                }}
              >
                RECHAZAR
              </button>
            </div>
            {errorByRequest[r.id] && (
              <p
                role="alert"
                style={{
                  margin: "8px 0 0",
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.burgundy,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                {errorByRequest[r.id]}
              </p>
            )}
          </div>
        );
      })}
      {requests.length === 0 && <EmptyMsg text="Sin solicitudes" />}
    </div>
  );
}

// ─── Columna pedidos ──────────────────────────────────────────────────────────
function OrdersColumn({
  orders,
  tables,
}: {
  orders: Order[];
  tables: Table[];
}) {
  const update = async (id: number, status: Order["status"]) => {
    await ordersApi.updateStatus(id, status);
  };

  const tableNumberBySessionId = new Map<number, number>();
  for (const t of tables) {
    if (t.current_session_id != null) {
      tableNumberBySessionId.set(t.current_session_id, t.number ?? t.id);
    }
  }

  const orderAmount = (o: Order) =>
    (o.order_items ?? []).reduce(
      (acc, it) => acc + (it.unit_price ?? 0) * it.quantity,
      0,
    );

  const next = {
    accepted: "preparing" as const,
    preparing: "ready" as const,
    ready: "delivered" as const,
  };
  const nextLabel = {
    accepted: "PREPARAR",
    preparing: "MARCAR LISTO",
    ready: "ENTREGAR",
  };

  return (
    <div style={{ flex: 1.4, minWidth: 260, overflowY: "auto", background: C.paper }}>
      <ColumnHeader label="Pedidos" count={orders.length} />
      {orders.map((o) => {
        const tableNumber =
          tableNumberBySessionId.get(o.table_session_id) ??
          o.table_session?.table_id;
        const transitionable =
          o.status === "accepted" ||
          o.status === "preparing" ||
          o.status === "ready";
        const amount = orderAmount(o);
        return (
        <div
          key={o.id}
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${C.sand}`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 16,
                  color: C.ink,
                  letterSpacing: 0.5,
                }}
              >
                {tableNumber != null ? `Mesa ${pad(tableNumber)}` : `Sesión ${o.table_session_id}`}
              </span>
              <Badge label={o.status} status={o.status} />
            </div>
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: C.gold, letterSpacing: 0.5 }}>
              {fmt(amount)}
            </span>
          </div>
          {transitionable && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                onClick={() => update(o.id, next[o.status as keyof typeof next])}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  background:
                    o.status === "ready"
                      ? `color-mix(in srgb, ${C.oliveSoft} 50%, transparent)`
                      : `color-mix(in srgb, ${C.goldSoft} 40%, transparent)`,
                  border: `1px solid ${o.status === "ready" ? C.olive : C.gold}`,
                  color: o.status === "ready" ? C.olive : C.gold,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 11,
                  letterSpacing: 2.5,
                  cursor: "pointer",
                  borderRadius: 999,
                  fontWeight: 600,
                }}
              >
                {nextLabel[o.status as keyof typeof nextLabel]}
              </button>
              <button
                onClick={() => update(o.id, "cancelled")}
                style={{
                  padding: "8px 12px",
                  background: C.burgundySoft,
                  border: `1px solid ${C.burgundy}`,
                  color: C.burgundy,
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                  cursor: "pointer",
                  borderRadius: 999,
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
        );
      })}
      {orders.length === 0 && <EmptyMsg text="Sin pedidos" />}
    </div>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
function ColumnHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderBottom: `1px solid ${C.sand}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: C.parchment,
        position: "sticky",
        top: 0,
        zIndex: 1,
      }}
    >
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 14,
          letterSpacing: 3,
          color: C.ink,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: C.mute,
          letterSpacing: 1.5,
          fontWeight: 600,
        }}
      >
        {count}
      </span>
    </div>
  );
}

function EmptyMsg({ text }: { text: string }) {
  return (
    <p
      style={{
        padding: 32,
        color: C.mute,
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 2,
        textTransform: "uppercase",
        textAlign: "center",
      }}
    >
      {text}
    </p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
type QueueStats = {
  songs_played_today: number;
  songs_skipped_today: number;
  songs_pending: number;
  total_songs_today: number;
  avg_wait_seconds: number | null;
  tables_participating: number;
  top_table: { table_id: number; count: number } | null;
};

/**
 * Small strip in the admin header showing the authenticated user and a
 * logout control. Lives next to the brand so staff always know who is
 * signed in on this workstation.
 */
function AdminWhoAmI() {
  const { user, logout } = useAdminAuth();
  if (!user) return null;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        marginLeft: 12,
        paddingLeft: 12,
        borderLeft: `1px solid ${C.sand}`,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 1.5,
          color: C.cacao,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {user.name}
        <span
          style={{
            marginLeft: 6,
            color: C.mute,
            fontWeight: 500,
            letterSpacing: 1,
          }}
        >
          · {user.role}
        </span>
      </span>
      <button
        type="button"
        onClick={logout}
        title="Cerrar sesión"
        style={{
          padding: "4px 10px",
          border: `1px solid ${C.sand}`,
          background: "transparent",
          color: C.mute,
          borderRadius: 999,
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 1.5,
          cursor: "pointer",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        Salir
      </button>
    </div>
  );
}

export default function AdminPage() {
  const actionRef = useRef(false);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [billDrawer, setBillDrawer] = useState<
    | { open: true; sessionId: number; tableNumber: number | null }
    | { open: false }
  >({ open: false });
  const {
    allTables,
    setAllTables,
    updateTable,
    queue,
    updateFromSocket,
    orders,
    setOrders,
    upsertOrder,
    orderRequests,
    setOrderRequests,
    upsertOrderRequest,
    currentPlayback,
    setCurrentPlayback,
  } = useAppStore();

  const refreshStats = useCallback(() => {
    queueApi.getStats().then(setStats).catch(console.error);
  }, []);

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => {
      updateFromSocket(q);
      refreshStats();
    },
    [updateFromSocket, refreshStats],
  );
  const handleTableUpdated = useCallback(
    (patch: Partial<Table> & { id: number }) => {
      // Projection emits partial patches for counters. Merge into the
      // current row rather than replacing it.
      const current = useAppStore
        .getState()
        .allTables.find((t) => t.id === patch.id);
      if (!current) {
        // New table we haven't seen: refetch list to stay consistent.
        tablesApi.getAll().then(setAllTables).catch(console.error);
        return;
      }
      updateTable({ ...current, ...patch });
    },
    [updateTable, setAllTables],
  );
  const handleOrderUpdated = useCallback(
    (o: Order) => upsertOrder(o),
    [upsertOrder],
  );
  const handleOrderRequestUpdated = useCallback(
    (r: OrderRequest) => upsertOrderRequest(r),
    [upsertOrderRequest],
  );
  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );

  useSocket({
    staff: true,
    onQueueUpdated: handleQueueUpdated,
    onTableUpdated: handleTableUpdated,
    onOrderCreated: handleOrderUpdated,
    onOrderUpdated: handleOrderUpdated,
    onOrderRequestCreated: handleOrderRequestUpdated,
    onOrderRequestUpdated: handleOrderRequestUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
  });

  useEffect(() => {
    tablesApi.getAll().then(setAllTables).catch(console.error);
    queueApi.getGlobal().then(updateFromSocket).catch(console.error);
    ordersApi
      .getAllForAdmin()
      .then((all) =>
        setOrders(
          // Only active orders are actionable; delivered/cancelled go to history.
          all.filter(
            (o) =>
              o.status === "accepted" ||
              o.status === "preparing" ||
              o.status === "ready",
          ),
        ),
      )
      .catch(console.error);
    orderRequestsApi
      .getAllForAdmin({ status: "pending" })
      .then(setOrderRequests)
      .catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
    refreshStats();
  }, [
    refreshStats,
    setAllTables,
    setCurrentPlayback,
    setOrders,
    setOrderRequests,
    updateFromSocket,
  ]);

  const handleSkipCurrent = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    setActionInProgress("skip");
    try {
      await queueApi.skipAndAdvance();
    } catch (error) {
      console.error(error);
    } finally {
      actionRef.current = false;
      setActionInProgress(null);
    }
  }, []);

  const handlePlayNext = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    setActionInProgress("play");
    try {
      await queueApi.advanceToNext();
    } catch (error) {
      console.error(error);
    } finally {
      actionRef.current = false;
      setActionInProgress(null);
    }
  }, []);

  const handleFinishCurrent = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    setActionInProgress("finish");
    try {
      await queueApi.finishCurrent();
    } catch (error) {
      console.error(error);
    } finally {
      actionRef.current = false;
      setActionInProgress(null);
    }
  }, []);

  const activeOrders = orders.filter(
    (o) =>
      o.status === "accepted" ||
      o.status === "preparing" ||
      o.status === "ready",
  );
  const pendingRequests = orderRequests.filter((r) => r.status === "pending");
  const revenue = allTables.reduce((a, t) => a + t.total_consumption, 0);
  const isPlaying =
    currentPlayback?.status === "playing" && Boolean(currentPlayback.song);
  const hasPendingSongs = queue.some((item) => item.status === "pending");

  const ctaBase: React.CSSProperties = {
    padding: "9px 14px",
    fontFamily: FONT_DISPLAY,
    fontSize: 12,
    letterSpacing: 2.5,
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    fontWeight: 600,
  };

  const openSessionsCount = allTables.filter(
    (t) => t.current_session_id != null,
  ).length;

  const statCards: { label: string; value: string | number; color: string }[] = [
    {
      label: "MESAS ACTIVAS",
      value: allTables.filter((t) => t.status === "occupied").length,
      color: C.olive,
    },
    {
      label: "SESIONES ABIERTAS",
      value: openSessionsCount,
      color: C.olive,
    },
    {
      label: "SOLICITUDES",
      value: pendingRequests.length,
      color: C.burgundy,
    },
    { label: "EN COLA", value: queue.length, color: C.gold },
    { label: "PEDIDOS", value: activeOrders.length, color: C.gold },
    { label: "REPROD. HOY", value: stats?.songs_played_today ?? 0, color: C.ink },
    { label: "SALTADAS", value: stats?.songs_skipped_today ?? 0, color: C.burgundy },
    {
      label: "ESPERA PROM.",
      value:
        stats?.avg_wait_seconds != null
          ? `${Math.floor(stats.avg_wait_seconds / 60)}m ${stats.avg_wait_seconds % 60}s`
          : "—",
      color: C.cacao,
    },
    {
      label: "TOP MESA",
      value: stats?.top_table ? `${pad(stats.top_table.table_id)} (${stats.top_table.count})` : "—",
      color: C.burgundy,
    },
    { label: "CONSUMO TOTAL", value: fmt(revenue), color: C.gold },
  ];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: ${C.sandDark}; border-radius: 999px; }
      `}</style>

      <div
        style={{
          minHeight: "100dvh",
          height: "100dvh",
          background: `
            radial-gradient(ellipse at 10% 0%, rgba(184,137,74,0.06), transparent 55%),
            radial-gradient(ellipse at 95% 95%, rgba(139,38,53,0.04), transparent 50%),
            ${C.cream}
          `,
          color: C.ink,
          fontFamily: FONT_UI,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: `1px solid ${C.sand}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: `linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%)`,
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 3,
                color: C.mute,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              — Crown Bar 4.90
            </span>
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                color: C.ink,
                letterSpacing: 4,
                textTransform: "uppercase",
              }}
            >
              Panel Admin
            </span>
            <AdminWhoAmI />
            <Link
              href="/admin/products"
              style={{
                marginLeft: 12,
                paddingLeft: 12,
                borderLeft: `1px solid ${C.sand}`,
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1.5,
                color: C.cacao,
                textDecoration: "none",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Productos →
            </Link>
            <Link
              href="/admin/sales"
              style={{
                marginLeft: 8,
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1.5,
                color: C.cacao,
                textDecoration: "none",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Ventas →
            </Link>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
            {statCards.map((s) => (
              <div key={s.label} style={{ textAlign: "right", minWidth: 72 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: C.mute,
                    fontFamily: FONT_MONO,
                    letterSpacing: 2,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    marginBottom: 2,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 20,
                    color: s.color,
                    letterSpacing: 0.5,
                    lineHeight: 1,
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Playback bar */}
        <div
          style={{
            padding: "14px 24px",
            borderBottom: `1px solid ${C.sand}`,
            background: isPlaying
              ? `linear-gradient(90deg, color-mix(in srgb, ${C.oliveSoft} 55%, ${C.paper}) 0%, ${C.paper} 100%)`
              : C.paper,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 14 }}>
            <div
              aria-hidden
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: isPlaying
                  ? `linear-gradient(135deg, ${C.gold} 0%, ${C.burgundy} 100%)`
                  : C.sand,
                color: isPlaying ? C.paper : C.mute,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONT_DISPLAY,
                fontSize: 20,
                flexShrink: 0,
              }}
            >
              ♪
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 9,
                  color: C.mute,
                  letterSpacing: 2.5,
                  fontFamily: FONT_MONO,
                  marginBottom: 4,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                Sonando ahora
              </div>
              {isPlaying ? (
                <>
                  <div
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 20,
                      color: C.ink,
                      lineHeight: 1.1,
                      letterSpacing: 0.5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {currentPlayback.song?.title}
                  </div>
                  <div style={{ fontSize: 10, color: C.cacao, fontFamily: FONT_MONO, marginTop: 3, letterSpacing: 1 }}>
                    {currentPlayback.table_id ? `Mesa ${pad(currentPlayback.table_id)}` : "ADMIN"}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: C.mute, fontFamily: FONT_MONO, letterSpacing: 1.5, textTransform: "uppercase" }}>
                  Sin reproducción activa
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: isPlaying ? C.olive : C.mute,
                padding: "5px 11px",
                borderRadius: 999,
                border: `1px solid ${isPlaying ? C.oliveSoft : C.sand}`,
                background: isPlaying ? `color-mix(in srgb, ${C.oliveSoft} 40%, transparent)` : "transparent",
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1.5,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "currentColor",
                }}
              />
              {isPlaying ? "Activa" : currentPlayback?.status === "paused" ? "Pausado" : "Idle"}
            </div>

            {!isPlaying && hasPendingSongs && (
              <button
                onClick={() => void handlePlayNext()}
                disabled={actionInProgress !== null}
                style={{
                  ...ctaBase,
                  background: actionInProgress === "play"
                    ? C.sand
                    : `linear-gradient(135deg, ${C.olive} 0%, #7F934F 100%)`,
                  color: actionInProgress === "play" ? C.mute : C.paper,
                  opacity: actionInProgress && actionInProgress !== "play" ? 0.5 : 1,
                  cursor: actionInProgress ? "not-allowed" : "pointer",
                }}
              >
                {actionInProgress === "play" ? "INICIANDO..." : "▶ REPRODUCIR SIGUIENTE"}
              </button>
            )}
            {isPlaying && (
              <>
                <button
                  onClick={() => void handleSkipCurrent()}
                  disabled={actionInProgress !== null}
                  style={{
                    ...ctaBase,
                    background: actionInProgress === "skip"
                      ? C.sand
                      : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
                    color: actionInProgress === "skip" ? C.mute : C.paper,
                    opacity: actionInProgress && actionInProgress !== "skip" ? 0.5 : 1,
                    cursor: actionInProgress ? "not-allowed" : "pointer",
                  }}
                >
                  {actionInProgress === "skip" ? "SALTANDO..." : "SALTAR"}
                </button>
                <button
                  onClick={() => void handleFinishCurrent()}
                  disabled={actionInProgress !== null}
                  style={{
                    ...ctaBase,
                    background: "transparent",
                    color: actionInProgress === "finish" ? C.mute : C.cacao,
                    border: `1px solid ${C.sand}`,
                    opacity: actionInProgress && actionInProgress !== "finish" ? 0.5 : 1,
                    cursor: actionInProgress ? "not-allowed" : "pointer",
                  }}
                >
                  {actionInProgress === "finish" ? "FINALIZANDO..." : "FINALIZAR"}
                </button>
              </>
            )}
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                ...ctaBase,
                background: `linear-gradient(135deg, ${C.burgundy} 0%, #A03245 100%)`,
                color: C.paper,
              }}
            >
              + AGREGAR
            </button>
            <a
              href="/player"
              target="_blank"
              rel="noreferrer"
              style={{
                ...ctaBase,
                background: "transparent",
                border: `1px solid ${C.sand}`,
                color: C.cacao,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              ⤢ PLAYER
            </a>
          </div>
        </div>

        {/* Columnas */}
        <div
          style={{
            flex: 1,
            display: "flex",
            overflow: "hidden",
            margin: 16,
            borderRadius: 16,
            border: `1px solid ${C.sand}`,
            boxShadow: C.shadow,
            background: C.paper,
          }}
        >
          <TablesColumn
            tables={allTables}
            onOpenBill={(sessionId, tableNumber) =>
              setBillDrawer({ open: true, sessionId, tableNumber })
            }
          />
          <QueueColumn queue={queue} />
          <PendingRequestsColumn
            requests={pendingRequests}
            tables={allTables}
          />
          <OrdersColumn orders={activeOrders} tables={allTables} />
        </div>
      </div>

      <AdminSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
      />

      <AdminBillDrawer
        open={billDrawer.open}
        sessionId={billDrawer.open ? billDrawer.sessionId : null}
        tableNumber={billDrawer.open ? billDrawer.tableNumber : null}
        onClose={() => setBillDrawer({ open: false })}
      />
    </>
  );
}
