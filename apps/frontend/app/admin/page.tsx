"use client";

import { useEffect, useCallback } from "react";
import { useAppStore } from "@/store";
import { useSocket } from "@/lib/socket/useSocket";
import { tablesApi, queueApi, ordersApi, playbackApi } from "@/lib/api/services";
import type { QueueItem, Table, Order, PlaybackState } from "@coffee-bar/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const pad = (n: number) => String(n).padStart(2, "0");

const statusColor: Record<string, string> = {
  available: "#3b82f6",
  active: "#22c55e",
  inactive: "#555",
  occupied: "#f97316",
  pending: "#FFDC32",
  preparing: "#FF8C00",
  ready: "#3b82f6",
  delivered: "#22c55e",
  cancelled: "#ef4444",
  played: "#555",
  skipped: "#ef4444",
};

function Badge({ label, status }: { label: string; status: string }) {
  const color = statusColor[status] ?? "#555";
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "monospace",
        letterSpacing: 1,
        color,
        border: `1px solid ${color}33`,
        padding: "2px 7px",
      }}
    >
      {label.toUpperCase()}
    </span>
  );
}

// ─── Columna mesas ────────────────────────────────────────────────────────────
function TablesColumn({ tables }: { tables: Table[] }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 200,
        borderRight: "1px solid #1a1a1a",
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a" }}>
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 13,
            letterSpacing: 3,
            color: "#555",
          }}
        >
          MESAS
        </span>
      </div>
      {tables.map((t) => (
        <div
          key={t.id}
          style={{ padding: "12px 16px", borderBottom: "1px solid #111" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 22,
                color: "#f5f5f5",
              }}
            >
              {pad(t.id)}
            </span>
            <Badge label={t.status} status={t.status} />
          </div>
          <div
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 14,
              color: "#FFDC32",
            }}
          >
            {fmt(t.total_consumption)}
          </div>
        </div>
      ))}
      {tables.length === 0 && (
        <p
          style={{
            padding: 24,
            color: "#333",
            fontFamily: "monospace",
            fontSize: 10,
            letterSpacing: 2,
          }}
        >
          SIN MESAS
        </p>
      )}
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
        minWidth: 240,
        borderRight: "1px solid #1a1a1a",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #1a1a1a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 13,
            letterSpacing: 3,
            color: "#555",
          }}
        >
          COLA GLOBAL
        </span>
        <span
          style={{ fontFamily: "monospace", fontSize: 10, color: "#383838" }}
        >
          {queue.length} canciones
        </span>
      </div>
      {queue.map((item, i) => {
        const playing = item.status === "playing";
        return (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              borderBottom: "1px solid #111",
              opacity: playing ? 1 : 0.7,
            }}
          >
            <span
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: playing ? 18 : 13,
                color: playing ? "#FFDC32" : "#383838",
                width: 22,
                textAlign: "center",
              }}
            >
              {playing ? "▶" : pad(i + 1)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 13,
                  color: playing ? "#f5f5f5" : "#aaa",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.song?.title ?? `Song #${item.song_id}`}
              </div>
              <div
                style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}
              >
                Mesa {pad(item.table_id)} · pos. {item.position}
              </div>
            </div>
            {!playing && (
              <button
                onClick={() => skip(item.id)}
                style={{
                  background: "none",
                  border: "1px solid #2a2a2a",
                  color: "#555",
                  padding: "3px 8px",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                SKIP
              </button>
            )}
          </div>
        );
      })}
      {queue.length === 0 && (
        <p
          style={{
            padding: 24,
            color: "#333",
            fontFamily: "monospace",
            fontSize: 10,
            letterSpacing: 2,
          }}
        >
          COLA VACÍA
        </p>
      )}
    </div>
  );
}

// ─── Columna pedidos ──────────────────────────────────────────────────────────
function OrdersColumn({ orders }: { orders: Order[] }) {
  const update = async (id: number, status: Order["status"]) => {
    await ordersApi.updateStatus(id, status);
  };

  return (
    <div style={{ flex: 1.4, minWidth: 240, overflowY: "auto" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #1a1a1a" }}>
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 13,
            letterSpacing: 3,
            color: "#555",
          }}
        >
          PEDIDOS
        </span>
      </div>
      {orders.map((o) => (
        <div
          key={o.id}
          style={{ padding: "12px 16px", borderBottom: "1px solid #111" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 14,
                  color: "#f5f5f5",
                }}
              >
                Mesa {pad(o.table_id)}
              </span>
              <Badge label={o.status} status={o.status} />
            </div>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                color: "#FFDC32",
              }}
            >
              {fmt(o.total)}
            </span>
          </div>
          {o.status === "pending" && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button
                onClick={() => update(o.id, "preparing")}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  background: "none",
                  border: "1px solid #FFDC32",
                  color: "#FFDC32",
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 11,
                  letterSpacing: 2,
                  cursor: "pointer",
                }}
              >
                PREPARAR
              </button>
              <button
                onClick={() => update(o.id, "cancelled")}
                style={{
                  padding: "6px 10px",
                  background: "none",
                  border: "1px solid #2a2a2a",
                  color: "#555",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          )}
          {o.status === "preparing" && (
            <button
              onClick={() => update(o.id, "delivered")}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "6px 0",
                background: "#22c55e22",
                border: "1px solid #22c55e",
                color: "#22c55e",
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 11,
                letterSpacing: 2,
                cursor: "pointer",
              }}
            >
              ENTREGAR
            </button>
          )}
        </div>
      ))}
      {orders.length === 0 && (
        <p
          style={{
            padding: 24,
            color: "#333",
            fontFamily: "monospace",
            fontSize: 10,
            letterSpacing: 2,
          }}
        >
          SIN PEDIDOS
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const {
    allTables,
    setAllTables,
    updateTable,
    queue,
    updateFromSocket,
    orders,
    setOrders,
    upsertOrder,
    currentPlayback,
    setCurrentPlayback,
  } = useAppStore();

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => updateFromSocket(q),
    [updateFromSocket],
  );
  const handleTableUpdated = useCallback(
    (t: Table) => updateTable(t),
    [updateTable],
  );
  const handleOrderUpdated = useCallback(
    (o: Order) => upsertOrder(o),
    [upsertOrder],
  );
  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );

  useSocket({
    onQueueUpdated: handleQueueUpdated,
    onTableUpdated: handleTableUpdated,
    onOrderUpdated: handleOrderUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
  });

  useEffect(() => {
    tablesApi.getAll().then(setAllTables).catch(console.error);
    queueApi.getGlobal().then(updateFromSocket).catch(console.error);
    ordersApi.getAll().then(setOrders).catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
  }, []);

  const activeOrders = orders.filter(
    (o) => o.status === "pending" || o.status === "preparing",
  );
  const revenue = allTables.reduce((a, t) => a + t.total_consumption, 0);
  const isPlaying = currentPlayback?.status === "playing" && currentPlayback.song;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <div
        style={{
          minHeight: "100dvh",
          background: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #1a1a1a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 20,
              color: "#f5f5f5",
              letterSpacing: 3,
            }}
          >
            PANEL ADMIN
          </span>
          <div style={{ display: "flex", gap: 24 }}>
            {[
              {
                label: "MESAS ACTIVAS",
                value: allTables.filter((t) => t.status === "active").length,
              },
              { label: "EN COLA", value: queue.length },
              { label: "PEDIDOS", value: activeOrders.length },
              { label: "CONSUMO TOTAL", value: fmt(revenue) },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "#444",
                    fontFamily: "monospace",
                    letterSpacing: 2,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontFamily: "'Bebas Neue',Impact,sans-serif",
                    fontSize: 18,
                    color: "#FFDC32",
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #161616",
            background: isPlaying ? "rgba(255,220,50,0.06)" : "#0d0d0d",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 9,
                color: "#555",
                letterSpacing: 2,
                fontFamily: "monospace",
                marginBottom: 6,
              }}
            >
              SONANDO AHORA
            </div>
            {isPlaying ? (
              <>
                <div
                  style={{
                    fontFamily: "'Bebas Neue',Impact,sans-serif",
                    fontSize: 22,
                    color: "#f5f5f5",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {currentPlayback.song?.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#777",
                    fontFamily: "monospace",
                    marginTop: 4,
                  }}
                >
                  Mesa {pad(currentPlayback.table_id ?? 0)}
                </div>
              </>
            ) : (
              <div
                style={{
                  fontSize: 10,
                  color: "#444",
                  fontFamily: "monospace",
                  letterSpacing: 1,
                }}
              >
                AUN NO HAY UNA CANCION REPRODUCIENDOSE
              </div>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: isPlaying ? "#22c55e" : "#666",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isPlaying ? "#22c55e" : "#666",
              }}
            />
            <span
              style={{
                fontFamily: "'Bebas Neue',Impact,sans-serif",
                fontSize: 12,
                letterSpacing: 2,
              }}
            >
              {isPlaying ? "ACTIVA" : "IDLE"}
            </span>
          </div>
        </div>

        {/* Columnas */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <TablesColumn tables={allTables} />
          <QueueColumn queue={queue} />
          <OrdersColumn orders={activeOrders} />
        </div>
      </div>
    </>
  );
}
