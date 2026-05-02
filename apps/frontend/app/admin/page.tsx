"use client";

import Link from "next/link";
import { useEffect, useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/store";
import { useSocket } from "@/lib/socket/useSocket";
import {
  tablesApi,
  queueApi,
  ordersApi,
  orderRequestsApi,
  playbackApi,
  productsApi,
  musicApi,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { useAdminAuth } from "@/lib/auth/auth-context";
import { AdminBillDrawer } from "@/components/admin/AdminBillDrawer";
import { KpiStrip, type Kpi } from "@/components/admin/KpiStrip";
import { TablesMap } from "@/components/admin/TablesMap";
import { MusicPanel } from "@/components/admin/MusicPanel";
import type {
  Order,
  OrderRequest,
  PlaybackState,
  Product,
  QueueItem,
  Table,
  YouTubeSearchResult,
} from "@coffee-bar/shared";

import {
  C,
  FONT_DISPLAY,
  FONT_UI,
  FONT_MONO,
  fmt,
  pad,
  secToMin,
  btnPrimary,
  btnGhost,
  BUTTON_STYLES,
  SHARED_KEYFRAMES,
  DUR_BASE,
  DUR_SLOW,
} from "@/lib/theme";

// Map existing statuses to our warm palette
const statusColor: Record<string, string> = {
  available: C.gold,
  active: C.olive,
  inactive: C.mute,
  occupied: C.terracotta,
  pending: C.gold,
  preparing: C.terracotta,
  ready: C.olive,
  delivered: C.olive,
  cancelled: C.terracotta,
  played: C.mute,
  skipped: C.terracotta,
};

// Marca una entidad como "fresca" si llegó hace menos de N segundos.
// Lo usamos para resaltar visualmente solicitudes/pedidos recién creados
// (barra lateral pulsante) — es purely visual, no afecta lógica.
const FRESH_WINDOW_MS = 6_000;
function isRecent(createdAt: string | Date | null | undefined): boolean {
  if (!createdAt) return false;
  const t = typeof createdAt === "string" ? new Date(createdAt).getTime() : createdAt.getTime();
  return Date.now() - t < FRESH_WINDOW_MS;
}

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
            className="crown-btn crown-btn-ghost"
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
              background: C.terracottaSoft,
              border: `1px solid ${C.terracotta}`,
              color: C.terracotta,
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
                      background: `linear-gradient(135deg, ${C.goldSoft} 0%, ${C.terracottaSoft} 100%)`,
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
                    className="crown-btn crown-btn-hero"
                    onClick={() => handlePlayNow(r)}
                    disabled={isAdding}
                    style={{
                      padding: "7px 11px",
                      background: isAdding ? C.sand : C.terracotta,
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
                    className="crown-btn crown-btn-hero"
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
                    className="crown-btn crown-btn-ghost"
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

// ─── Columna solicitudes pendientes ──────────────────────────────────────────
// Why: customers create OrderRequests that need explicit staff review before
// stock is decremented. This column is the single place where accept/reject
// happens — without it, no customer request can ever become an Order.
function PendingRequestsColumn({
  requests,
  tables,
  products,
}: {
  requests: OrderRequest[];
  tables: Table[];
  products: Product[];
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

  // OrderRequest stores items as a JSON array of {product_id, quantity};
  // we resolve names through the public catalog snapshot loaded at boot.
  const productById = new Map<number, Product>();
  for (const p of products) productById.set(p.id, p);

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
      <AnimatePresence initial={false}>
      {requests.map((r) => {
        const tableNumber =
          tableNumberBySessionId.get(r.table_session_id) ??
          r.table_session?.table_id;
        const items = Array.isArray(r.items) ? r.items : [];
        const itemsCount = items.reduce((acc, it) => acc + (it.quantity ?? 0), 0);
        const busy = busyId === r.id;
        const isFresh = isRecent(r.created_at);
        return (
          <motion.div
            key={r.id}
            layout
            initial={{ opacity: 0, x: -16, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.95 }}
            transition={{
              duration: DUR_SLOW / 1000,
              ease: [0.16, 1, 0.3, 1],
              layout: { duration: DUR_BASE / 1000 },
            }}
            style={{
              position: "relative",
              padding: "14px 18px",
              borderBottom: `1px solid ${C.sand}`,
              background: isFresh
                ? `color-mix(in srgb, ${C.terracottaSoft} 18%, transparent)`
                : "transparent",
            }}
          >
            {isFresh && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  background: C.terracotta,
                  animation: "crown-fresh-pulse 1.6s ease-in-out infinite",
                }}
              />
            )}
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

            {items.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  margin: "0 0 10px",
                  padding: "8px 10px",
                  background: C.parchment,
                  border: `1px solid ${C.sand}`,
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {items.map((it, idx) => {
                  const p = productById.get(it.product_id);
                  return (
                    <li
                      key={`${r.id}-${it.product_id}-${idx}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 8,
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        letterSpacing: 0.4,
                        color: C.ink,
                      }}
                    >
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ color: C.gold, fontWeight: 700 }}>
                          {it.quantity}×
                        </strong>{" "}
                        {p ? p.name : `Producto #${it.product_id}`}
                      </span>
                      {p && (
                        <span style={{ color: C.mute, fontSize: 10 }}>
                          {p.category}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="crown-btn crown-btn-primary"
                onClick={() => run(r.id, "accept")}
                disabled={busy}
                style={btnPrimary({
                  bg: busy ? C.sand : C.olive,
                  fg: busy ? C.mute : C.paper,
                  fullWidth: true,
                })}
              >
                ACEPTAR
              </button>
              <button
                className="crown-btn crown-btn-ghost crown-btn-ghost-danger"
                onClick={() => run(r.id, "reject")}
                disabled={busy}
                style={btnGhost({ fg: C.terracotta })}
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
                  color: C.terracotta,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                {errorByRequest[r.id]}
              </p>
            )}
          </motion.div>
        );
      })}
      </AnimatePresence>
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

  // Single-step delivery: customers don't see the preparing/ready
  // intermediates today. Backend still allows them, so a future kitchen
  // screen could re-introduce stages without touching this map.
  const next = {
    accepted: "delivered" as const,
    preparing: "delivered" as const,
    ready: "delivered" as const,
  };
  const nextLabel = {
    accepted: "ENTREGAR",
    preparing: "ENTREGAR",
    ready: "ENTREGAR",
  };

  return (
    <div style={{ flex: 1.4, minWidth: 260, overflowY: "auto", background: C.paper }}>
      <ColumnHeader label="Pedidos" count={orders.length} />
      <AnimatePresence initial={false}>
      {orders.map((o) => {
        const tableNumber =
          tableNumberBySessionId.get(o.table_session_id) ??
          o.table_session?.table_id;
        const transitionable =
          o.status === "accepted" ||
          o.status === "preparing" ||
          o.status === "ready";
        const amount = orderAmount(o);
        const isFresh = isRecent(o.created_at);
        return (
        <motion.div
          key={o.id}
          layout
          initial={{ opacity: 0, x: -16, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 60, scale: 0.95 }}
          transition={{
            duration: DUR_SLOW / 1000,
            ease: [0.16, 1, 0.3, 1],
            layout: { duration: DUR_BASE / 1000 },
          }}
          style={{
            position: "relative",
            padding: "14px 18px",
            borderBottom: `1px solid ${C.sand}`,
            background: isFresh
              ? `color-mix(in srgb, ${C.goldSoft} 22%, transparent)`
              : "transparent",
          }}
        >
          {isFresh && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                background: C.gold,
                animation: "crown-fresh-pulse 1.6s ease-in-out infinite",
              }}
            />
          )}
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
          {(o.order_items?.length ?? 0) > 0 && (
            <ul
              style={{
                listStyle: "none",
                padding: "8px 12px",
                margin: "0 0 10px",
                background: C.cream,
                border: `1px solid ${C.sand}`,
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {o.order_items!.map((it) => {
                const name =
                  it.product?.name ?? `Producto ${it.product_id}`;
                return (
                  <li
                    key={it.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                      fontFamily: FONT_UI,
                      fontSize: 13,
                      color: C.ink,
                    }}
                  >
                    <span>
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 11,
                          color: C.cacao,
                          fontWeight: 700,
                          marginRight: 6,
                        }}
                      >
                        {it.quantity}×
                      </span>
                      {name}
                    </span>
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: C.mute,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmt((it.unit_price ?? 0) * it.quantity)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {transitionable && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                className="crown-btn crown-btn-primary"
                onClick={() => update(o.id, next[o.status as keyof typeof next])}
                style={btnPrimary({ bg: C.gold, fg: C.paper, fullWidth: true })}
              >
                {nextLabel[o.status as keyof typeof nextLabel]}
              </button>
              <button
                className="crown-btn crown-btn-ghost crown-btn-ghost-danger"
                onClick={() => update(o.id, "cancelled")}
                aria-label="Cancelar pedido"
                style={{
                  ...btnGhost({ fg: C.terracotta }),
                  padding: "9px 12px",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          )}
        </motion.div>
        );
      })}
      </AnimatePresence>
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
        background: `linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%)`,
        position: "sticky",
        top: 0,
        zIndex: 2,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
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
      <CountBadge count={count} />
    </div>
  );
}

/**
 * Badge numérico con cross-fade al cambiar — usado en column headers para
 * que el operador vea (sin tener que mirar) que la cifra cambió. La key
 * del `motion.span` es el valor mismo, así que cualquier delta hace que
 * AnimatePresence saque el viejo y meta el nuevo con un slide+fade.
 */
function CountBadge({ count }: { count: number }) {
  const isZero = count === 0;
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 22,
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        background: isZero ? "transparent" : C.gold,
        color: isZero ? C.mute : C.paper,
        fontFamily: FONT_MONO,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.5,
        border: isZero ? `1px solid ${C.sand}` : "none",
        overflow: "hidden",
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={count}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: DUR_BASE / 1000, ease: [0.16, 1, 0.3, 1] }}
          style={{ display: "inline-block", lineHeight: 1 }}
        >
          {count}
        </motion.span>
      </AnimatePresence>
    </span>
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
        className="crown-btn crown-btn-ghost crown-btn-ghost-danger"
        onClick={logout}
        title="Cerrar sesión"
        style={btnGhost({ fg: C.terracotta, border: C.terracotta })}
      >
        Salir
      </button>
    </div>
  );
}

export default function AdminPage() {
  const actionRef = useRef(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Catalog snapshot, used to resolve product names inside OrderRequest.items
  // (the JSON column on OrderRequest only stores product_id + quantity).
  const [products, setProducts] = useState<Product[]>([]);
  // Lightweight in-page toast queue. Currently used only for customer
  // cancellations (the rest of the admin surface already has explicit UI
  // for state changes — adding toasts there would be noise).
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const pushToast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);
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

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => {
      updateFromSocket(q);
    },
    [updateFromSocket],
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
    (r: OrderRequest) => {
      // Detect a customer-driven cancellation by comparing the incoming
      // status against the prior copy in the store. If the previous row was
      // pending and now arrives as cancelled, that transition can only have
      // come from the customer (admin uses reject, not cancel, for pending
      // requests). Surface a toast so staff sees the change without staring
      // at the column.
      const previous = useAppStore
        .getState()
        .orderRequests.find((existing) => existing.id === r.id);
      if (
        r.status === "cancelled" &&
        previous &&
        previous.status === "pending"
      ) {
        const tableNumber =
          useAppStore
            .getState()
            .allTables.find(
              (t) => t.current_session_id === r.table_session_id,
            )?.number ?? r.table_session?.table_id ?? null;
        const label = tableNumber != null ? `Mesa ${pad(tableNumber)}` : `Sesión ${r.table_session_id}`;
        pushToast(`${label}: pedido #${r.id} cancelado por el cliente`);
      }
      upsertOrderRequest(r);
    },
    [upsertOrderRequest, pushToast],
  );
  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );
  // Detect customer-driven payment requests so the admin sees a toast.
  // We only fire on the transition `null → set`. Refreshing the tables
  // list is the simplest way to keep `current_session.payment_requested_at`
  // in sync for the badge.
  const handleTableSessionUpdated = useCallback(
    (s: { id: number; payment_requested_at?: string | null; paid_at?: string | null }) => {
      const tables = useAppStore.getState().allTables;
      const matching = tables.find((t) => t.current_session_id === s.id);
      const previous = matching?.current_session?.payment_requested_at ?? null;
      if (s.payment_requested_at && !previous) {
        const tableNumber = matching?.number ?? null;
        const label = tableNumber != null ? `Mesa ${pad(tableNumber)}` : `Sesión ${s.id}`;
        pushToast(`${label}: pidió la cuenta`);
      }
      // Always refresh the tables snapshot so badges stay accurate after
      // request/cancel/markPaid transitions.
      tablesApi.getAll().then(setAllTables).catch(console.error);
    },
    [pushToast, setAllTables],
  );

  useSocket({
    staff: true,
    onQueueUpdated: handleQueueUpdated,
    onTableUpdated: handleTableUpdated,
    onOrderCreated: handleOrderUpdated,
    onOrderUpdated: handleOrderUpdated,
    onOrderRequestCreated: handleOrderRequestUpdated,
    onOrderRequestUpdated: handleOrderRequestUpdated,
    onTableSessionUpdated: handleTableSessionUpdated,
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
    productsApi.getAll().then(setProducts).catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
  }, [
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

  // 4 KPIs core. El resto (música stats, top mesa, etc.) viven en su propio
  // panel — el header solo muestra lo que el operador necesita ver de
  // reojo durante el servicio. `tone` mapea a color semántico:
  //   success → mesas activas (estado OK del salón).
  //   alert   → solicitudes (atención requerida).
  //   warm    → pedidos en curso (trabajo en marcha).
  //   neutral → consumo (cifra de referencia).
  const kpis: Kpi[] = [
    {
      label: "Mesas activas",
      value: allTables.filter((t) => t.status === "occupied").length,
      numericValue: allTables.filter((t) => t.status === "occupied").length,
      tone: "success",
    },
    {
      label: "Solicitudes",
      value: pendingRequests.length,
      numericValue: pendingRequests.length,
      tone: "alert",
    },
    {
      label: "Pedidos activos",
      value: activeOrders.length,
      numericValue: activeOrders.length,
      tone: "warm",
    },
    {
      label: "Consumo hoy",
      value: fmt(revenue),
      numericValue: revenue,
      format: fmt,
      tone: "neutral",
    },
  ];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: ${C.sandDark}; border-radius: 999px; }
        ${SHARED_KEYFRAMES}
        ${BUTTON_STYLES}
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
              className="crown-btn crown-btn-ghost"
              style={{
                ...btnGhost({ fg: C.cacao, border: C.sand }),
                marginLeft: 12,
                textDecoration: "none",
              }}
            >
              Productos →
            </Link>
            <Link
              href="/admin/sales"
              className="crown-btn crown-btn-ghost"
              style={{
                ...btnGhost({ fg: C.cacao, border: C.sand }),
                textDecoration: "none",
              }}
            >
              Ventas →
            </Link>
          </div>
          <KpiStrip kpis={kpis} />
        </div>


        {/* Layout principal: mapa de mesas (sidebar) + zona central con
            las columnas de operación (cola, solicitudes, pedidos). El
            mapa es siempre visible — el operador no debe perder de
            vista el estado del salón. */}
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
          <TablesMap
            tables={allTables}
            onSelect={(sessionId, tableNumber) => {
              if (sessionId == null) return;
              setBillDrawer({ open: true, sessionId, tableNumber });
            }}
          />
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <PendingRequestsColumn
              requests={pendingRequests}
              tables={allTables}
              products={products}
            />
            <OrdersColumn orders={activeOrders} tables={allTables} />
          </div>
          <MusicPanel
            playback={currentPlayback}
            queue={queue}
            onPlayNext={() => void handlePlayNext()}
            onSkip={() => void handleSkipCurrent()}
            onFinish={() => void handleFinishCurrent()}
            onSkipQueueItem={(id) => void queueApi.skip(id)}
            onAdd={() => setSearchOpen(true)}
            actionInProgress={actionInProgress}
          />
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

      <ToastStack toasts={toasts} />
    </>
  );
}

// ─── Toast stack ──────────────────────────────────────────────────────────────
// Bottom-right column of stacked toasts. Auto-dismiss is owned by the parent
// (push helper sets the timeout); this component is purely presentational.
function ToastStack({
  toasts,
}: {
  toasts: { id: number; message: string }[];
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 80,
          pointerEvents: "none",
          width: "100%",
          maxWidth: 380,
          alignItems: "stretch",
        }}
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.94 }}
              transition={{
                duration: DUR_BASE / 1000,
                ease: [0.16, 1, 0.3, 1],
              }}
              role="status"
              aria-live="assertive"
              style={{
                pointerEvents: "auto",
                background: C.ink,
                color: C.paper,
                padding: "14px 18px 14px 16px",
                borderRadius: 12,
                fontFamily: FONT_UI,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: 0.2,
                lineHeight: 1.35,
                boxShadow:
                  "0 18px 40px -12px rgba(43,29,20,0.55), 0 4px 12px -6px rgba(107,78,46,0.4)",
                borderLeft: `4px solid ${C.terracotta}`,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: C.terracottaSoft,
                  color: C.terracotta,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                ✕
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
    </div>
  );
}
