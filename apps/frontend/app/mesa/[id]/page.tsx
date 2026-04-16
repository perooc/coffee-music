"use client";

import { useEffect, use, useCallback } from "react";
import {
  useAppStore,
  selectCurrentPlayback,
  selectMyQueueCount,
} from "@/store";
import { useSocket } from "@/lib/socket/useSocket";
import {
  tablesApi,
  queueApi,
  ordersApi,
  playbackApi,
} from "@/lib/api/services";
import type {
  QueueItem,
  Table,
  Order,
  PlaybackState,
} from "@coffee-bar/shared";
import {
  MAX_SONGS_PER_TABLE,
  SCOREBOARD_MAX_CONSUMPTION,
} from "@coffee-bar/shared";
import SongSearch from "@/components/music/SongSearch";

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

// ─── Scoreboard ───────────────────────────────────────────────────────────────
function Scoreboard({
  table,
  playback,
}: {
  table: Table;
  playback: PlaybackState | null;
}) {
  const MAX = SCOREBOARD_MAX_CONSUMPTION;
  const pct = Math.min(100, Math.round((table.total_consumption / MAX) * 100));
  const isPlaying = playback?.status === "playing" && playback.song;
  const playbackColor = isPlaying ? "#22c55e" : "#666";
  const playbackLabel = isPlaying ? "SONANDO AHORA" : "SIN REPRODUCCION";

  return (
    <div
      style={{
        background: "#0a0a0a",
        borderBottom: "1px solid #1a1a1a",
        padding: "20px 20px 16px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 70,
          height: 70,
          background:
            "radial-gradient(circle at 0 0,rgba(255,220,50,0.13) 0%,transparent 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 70,
          height: 70,
          background:
            "radial-gradient(circle at 100% 0,rgba(255,220,50,0.13) 0%,transparent 70%)",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 11,
            letterSpacing: 3,
            color: "#555",
          }}
        >
          MESA
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: playbackColor,
              animation: isPlaying ? "pulse 2s infinite" : "none",
            }}
          />
          <span
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 10,
              letterSpacing: 2,
              color: playbackColor,
            }}
          >
            {playbackLabel}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 86,
            lineHeight: 1,
            color: "#f5f5f5",
            letterSpacing: -3,
          }}
        >
          {pad(table.id)}
        </span>
        <div>
          <div
            style={{
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 22,
              color: "#FFDC32",
            }}
          >
            {fmt(table.total_consumption)}
          </div>
        </div>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 5,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "#444",
              letterSpacing: 2,
              fontFamily: "monospace",
            }}
          >
            CONSUMO
          </span>
          <span
            style={{ fontSize: 10, color: "#FFDC32", fontFamily: "monospace" }}
          >
            {pct}%
          </span>
        </div>
        <div style={{ height: 4, background: "#1a1a1a", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "linear-gradient(90deg,#FFDC32,#FF8C00)",
              transition: "width 0.8s ease",
            }}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: "10px 12px",
          border: "1px solid #1a1a1a",
          background: isPlaying ? "rgba(255,220,50,0.06)" : "#0d0d0d",
        }}
      >
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
                fontSize: 16,
                color: "#f5f5f5",
                lineHeight: 1.1,
              }}
            >
              {playback.song?.title}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#777",
                fontFamily: "monospace",
                marginTop: 4,
              }}
            >
              {secToMin(playback.song?.duration ?? 0)} · Mesa{" "}
              {pad(playback.table_id ?? 0)}
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
    </div>
  );
}

// ─── Queue row ────────────────────────────────────────────────────────────────
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 0",
        borderBottom: "1px solid #111",
        opacity: playing ? 1 : 0.72,
      }}
    >
      <div
        style={{
          width: 26,
          minWidth: 26,
          fontFamily: "'Bebas Neue',Impact,sans-serif",
          fontSize: playing ? 20 : 15,
          color: playing ? "#FFDC32" : "#383838",
          textAlign: "center",
        }}
      >
        {playing ? "▶" : pad(index + 1)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 14,
            color: playing ? "#f5f5f5" : "#aaa",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.song?.title ?? item.song_id}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#444",
            fontFamily: "monospace",
            marginTop: 2,
          }}
        >
          {secToMin(item.song?.duration ?? 0)} · Mesa {pad(item.table_id)}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
        }}
      >
        {isMine && (
          <div
            style={{
              fontSize: 9,
              fontFamily: "monospace",
              letterSpacing: 1,
              color: "#FFDC32",
              background: "rgba(255,220,50,0.08)",
              border: "1px solid rgba(255,220,50,0.18)",
              padding: "2px 6px",
            }}
          >
            TU MESA
          </div>
        )}
        <div style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>
          {playing ? "AHORA" : `pos. ${item.position}`}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MesaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const tableId = parseInt(id, 10);

  const {
    currentTable,
    setCurrentTable,
    queue,
    updateFromSocket,
    orders,
    setOrders,
    isSearchOpen,
    setSearchOpen,
    activeTab,
    setActiveTab,
    upsertOrder,
    setCurrentPlayback,
  } = useAppStore();

  const currentPlayback = useAppStore(selectCurrentPlayback);
  const myQueueCount = useAppStore(selectMyQueueCount(tableId));

  const handleQueueUpdated = useCallback(
    (q: QueueItem[]) => updateFromSocket(buildMesaQueue(q, tableId)),
    [tableId, updateFromSocket],
  );
  const handleTableUpdated = useCallback(
    (t: Table) => {
      if (t.id === tableId) setCurrentTable(t);
    },
    [tableId, setCurrentTable],
  );
  const handleOrderUpdated = useCallback(
    (o: Order) => {
      if (o.table_id === tableId) upsertOrder(o);
    },
    [tableId, upsertOrder],
  );
  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );

  useSocket({
    tableId,
    onQueueUpdated: handleQueueUpdated,
    onTableUpdated: handleTableUpdated,
    onOrderUpdated: handleOrderUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
  });

  useEffect(() => {
    if (isNaN(tableId)) return;
    sessionStorage.setItem("table_id", String(tableId));
    tablesApi.getById(tableId).then(setCurrentTable).catch(console.error);
    ordersApi.getByTable(tableId).then(setOrders).catch(console.error);
    playbackApi.getCurrent().then(setCurrentPlayback).catch(console.error);
    queueApi
      .getByTable(tableId)
      .then((tableQueue) => {
        updateFromSocket(buildMesaQueue(tableQueue, tableId));
      })
      .catch(console.error);
  }, [tableId]);

  const myOrders = orders.filter((o) => o.table_id === tableId);
  const total = myOrders.reduce((a, o) => a + o.total, 0);

  const tabStyle = (tab: string): React.CSSProperties => ({
    flex: 1,
    padding: "13px 0",
    border: "none",
    cursor: "pointer",
    background: activeTab === tab ? "#FFDC32" : "#0f0f0f",
    color: activeTab === tab ? "#0a0a0a" : "#444",
    borderBottom:
      activeTab === tab ? "2px solid #FFDC32" : "2px solid transparent",
    fontFamily: "'Bebas Neue',Impact,sans-serif",
    fontSize: 13,
    letterSpacing: 3,
  });

  if (!currentTable) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            color: "#333",
            fontFamily: "monospace",
            letterSpacing: 3,
            fontSize: 11,
          }}
        >
          CARGANDO MESA {pad(tableId)}...
        </span>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        * { box-sizing: border-box; }
      `}</style>

      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          minHeight: "100dvh",
          background: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Scoreboard table={currentTable} playback={currentPlayback} />

        <div style={{ display: "flex", borderBottom: "1px solid #141414" }}>
          <button style={tabStyle("cola")} onClick={() => setActiveTab("cola")}>
            COLA MUSICAL
          </button>
          <button
            style={tabStyle("pedidos")}
            onClick={() => setActiveTab("pedidos")}
          >
            MIS PEDIDOS
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
          {activeTab === "cola" && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "12px 0 4px",
                  borderBottom: "1px solid #141414",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: "#383838",
                    fontFamily: "monospace",
                    letterSpacing: 2,
                  }}
                >
                  {queue.length} EN COLA
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "#383838",
                    fontFamily: "monospace",
                  }}
                >
                  TU MESA: {myQueueCount}/2
                </span>
              </div>
              {queue.map((item, i) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  index={i}
                  myTableId={tableId}
                />
              ))}
              {queue.length === 0 && (
                <p
                  style={{
                    textAlign: "center",
                    padding: "40px 0",
                    color: "#333",
                    fontFamily: "monospace",
                    fontSize: 11,
                    letterSpacing: 2,
                  }}
                >
                  COLA VACÍA — SÉ EL PRIMERO
                </p>
              )}
            </>
          )}

          {activeTab === "pedidos" && (
            <div style={{ padding: "16px 0 8px" }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 11,
                  letterSpacing: 3,
                  color: "#383838",
                  marginBottom: 12,
                }}
              >
                PEDIDO ACTUAL
              </div>
              {myOrders.length === 0 && (
                <p
                  style={{
                    textAlign: "center",
                    padding: "40px 0",
                    color: "#333",
                    fontFamily: "monospace",
                    fontSize: 11,
                    letterSpacing: 2,
                  }}
                >
                  SIN PEDIDOS AÚN
                </p>
              )}
              {total > 0 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "16px 0 0",
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
                    TOTAL MESA
                  </span>
                  <span
                    style={{
                      fontFamily: "'Bebas Neue',Impact,sans-serif",
                      fontSize: 20,
                      color: "#FFDC32",
                    }}
                  >
                    {fmt(total)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{ padding: "16px 20px 28px", borderTop: "1px solid #161616" }}
        >
          <button
            onClick={() => setSearchOpen(true)}
            disabled={myQueueCount >= MAX_SONGS_PER_TABLE}
            style={{
              width: "100%",
              padding: 16,
              background:
                myQueueCount >= MAX_SONGS_PER_TABLE ? "#1a1a1a" : "#FFDC32",
              border: "none",
              color:
                myQueueCount >= MAX_SONGS_PER_TABLE ? "#383838" : "#0a0a0a",
              fontFamily: "'Bebas Neue',Impact,sans-serif",
              fontSize: 18,
              letterSpacing: 4,
              cursor:
                myQueueCount >= MAX_SONGS_PER_TABLE ? "not-allowed" : "pointer",
            }}
          >
            {myQueueCount >= MAX_SONGS_PER_TABLE
              ? `LÍMITE DE ${MAX_SONGS_PER_TABLE} CANCIONES`
              : "♪ PEDIR CANCIÓN"}
          </button>
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
          }}
        />
      </div>
    </>
  );
}
