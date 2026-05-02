"use client";

import type { QueueItem } from "@coffee-bar/shared";

// Warm premium palette — same as mesa / SongSearch
const C = {
  paper: "#FFFDF8",
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
};
const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
const FONT_MONO = "var(--font-oswald), 'Oswald', ui-monospace, monospace";

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

function getWaitMessage(item: QueueItem, allQueue: QueueItem[]): string {
  if (item.status === "playing") return "Sonando ahora";
  if (item.status === "played") return "Reproducida";
  if (item.status === "skipped") return "Saltada";
  const songsAhead = allQueue.filter(
    (q) => q.position < item.position && q.status === "pending",
  ).length;
  if (songsAhead === 0) return "Tu canción es la siguiente";
  if (songsAhead === 1) return "Tu canción está próxima";
  if (songsAhead <= 3) return "Hay pocas canciones antes que la tuya";
  return "La espera puede ser un poco mayor";
}

function getStatusLabel(status: string) {
  switch (status) {
    case "playing":
      return { text: "SONANDO", color: C.gold };
    case "pending":
      return { text: "EN COLA", color: C.gold };
    case "skipped":
      return { text: "SALTADA", color: C.burgundy };
    case "played":
      return { text: "REPRODUCIDA", color: C.mute };
    default:
      return { text: status.toUpperCase(), color: C.mute };
  }
}

export function MySongsPanel({
  mySongs,
  globalQueue,
}: {
  mySongs: QueueItem[];
  globalQueue: QueueItem[];
}) {
  const statusOrder: Record<string, number> = { playing: 0, pending: 1, skipped: 2, played: 3 };
  const sorted = [...mySongs].sort((a, b) => {
    const orderA = statusOrder[a.status] ?? 4;
    const orderB = statusOrder[b.status] ?? 4;
    if (orderA !== orderB) return orderA - orderB;
    return a.position - b.position;
  });

  const active = sorted.filter((s) => s.status === "playing" || s.status === "pending");
  const history = sorted.filter((s) => s.status === "played" || s.status === "skipped");

  return (
    <div style={{ padding: "16px 0" }}>
      <style>{mysongsStyles}</style>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 3,
          color: C.mute,
          fontWeight: 600,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        — Tus canciones
      </div>
      <p
        style={{
          fontSize: 11,
          color: C.cacao,
          fontFamily: FONT_MONO,
          letterSpacing: 1,
          margin: "0 0 18px",
          lineHeight: 1.5,
        }}
      >
        Aquí puedes ver el estado de lo que has agregado a la cola.
      </p>

      {active.length === 0 && history.length === 0 && (
        <div style={{ textAlign: "center", padding: "56px 20px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 58,
              height: 58,
              borderRadius: "50%",
              background: `color-mix(in srgb, ${C.goldSoft} 70%, transparent)`,
              border: `1px solid ${C.goldSoft}`,
              color: C.gold,
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              marginBottom: 14,
            }}
          >
            ♪
          </div>
          <p
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 16,
              color: C.cacao,
              letterSpacing: 2,
              margin: 0,
              textTransform: "uppercase",
            }}
          >
            Aún no has agregado canciones
          </p>
        </div>
      )}

      <div aria-live="polite">
        {active.map((item) => {
          const status = getStatusLabel(item.status);
          const waitMsg = getWaitMessage(item, globalQueue);
          const isPlaying = item.status === "playing";

          return (
            <article
              key={item.id}
              style={{
                padding: "14px 12px",
                margin: "0 -12px 6px",
                borderRadius: 10,
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                borderBottom: `1px solid ${C.sand}`,
                background: isPlaying
                  ? `linear-gradient(90deg, color-mix(in srgb, ${C.goldSoft} 60%, transparent) 0%, transparent 100%)`
                  : "transparent",
                transition: "background 0.2s ease",
              }}
            >
              {isPlaying ? (
                <span className="mysongs-vinyl" aria-hidden />
              ) : (
                <div
                  style={{
                    width: 36,
                    minWidth: 36,
                    height: 36,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: C.goldSoft,
                    color: C.cacao,
                    fontFamily: FONT_DISPLAY,
                    fontSize: 14,
                    letterSpacing: 0,
                  }}
                >
                  {`#${item.position}`}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 15,
                      color: C.ink,
                      letterSpacing: 0.3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      lineHeight: 1.2,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {item.song?.title ?? `Song ${item.song_id}`}
                  </div>
                  {isPlaying && (
                    <span className="mysongs-eq" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: C.mute,
                    fontFamily: FONT_MONO,
                    marginTop: 5,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    letterSpacing: 1,
                  }}
                >
                  <span>{secToMin(item.song?.duration ?? 0)}</span>
                  <span
                    style={{
                      color: status.color,
                      letterSpacing: 1.5,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {isPlaying ? (
                      <span className="mysongs-dot" aria-hidden>
                        <span className="mysongs-dot-ping" />
                        <span className="mysongs-dot-core" />
                      </span>
                    ) : (
                      "●"
                    )}
                    {status.text}
                  </span>
                </div>
                <div
                  aria-live="polite"
                  style={{
                    fontSize: 11,
                    color: isPlaying ? C.gold : C.cacao,
                    fontFamily: FONT_MONO,
                    marginTop: 6,
                    letterSpacing: 0.5,
                    fontStyle: "italic",
                  }}
                >
                  {waitMsg}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {history.length > 0 && (
        <>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 3,
              color: C.mute,
              fontWeight: 600,
              textTransform: "uppercase",
              marginTop: 24,
              marginBottom: 10,
              paddingTop: 16,
              borderTop: `1px solid ${C.sand}`,
            }}
          >
            — Historial
          </div>
          {history.map((item) => {
            const status = getStatusLabel(item.status);
            const skipped = item.status === "skipped";
            return (
              <article
                key={item.id}
                style={{
                  padding: "10px 0",
                  borderBottom: `1px solid ${C.sand}`,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  opacity: 0.7,
                }}
              >
                <div
                  style={{
                    width: 30,
                    minWidth: 30,
                    textAlign: "center",
                    fontSize: 14,
                    color: skipped ? C.burgundy : C.mute,
                    fontFamily: FONT_DISPLAY,
                  }}
                >
                  {skipped ? "✕" : "✓"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 13,
                      color: C.cacao,
                      letterSpacing: 0.2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.song?.title ?? `Song ${item.song_id}`}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 2,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: status.color,
                      fontFamily: FONT_MONO,
                      letterSpacing: 1.2,
                      fontWeight: 700,
                    }}
                  >
                    {status.text}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: C.mute,
                      fontFamily: FONT_MONO,
                      letterSpacing: 0.5,
                    }}
                  >
                    {timeAgo(item.updated_at)}
                  </span>
                </div>
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}

const mysongsStyles = `
  @keyframes mysongs-vinyl-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes mysongs-eq-1 {
    0%, 100% { transform: scaleY(0.3); }
    50%      { transform: scaleY(1);   }
  }
  @keyframes mysongs-eq-2 {
    0%, 100% { transform: scaleY(0.55); }
    50%      { transform: scaleY(0.2);  }
  }
  @keyframes mysongs-eq-3 {
    0%, 100% { transform: scaleY(0.8);  }
    50%      { transform: scaleY(0.35); }
  }
  @keyframes mysongs-ping {
    0%   { transform: scale(1);   opacity: 0.6; }
    80%  { transform: scale(2.4); opacity: 0;   }
    100% { transform: scale(2.4); opacity: 0;   }
  }
  /* Mini vinyl record next to the playing track. Same DNA as the
     NowPlayingCard artwork but smaller — keeps the visual language
     consistent across the mesa view. */
  .mysongs-vinyl {
    position: relative;
    width: 36px;
    min-width: 36px;
    height: 36px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 50%, ${C.paper} 0%, ${C.paper} 12%, transparent 12%),
      radial-gradient(circle at 50% 50%, ${C.cacao} 14%, ${C.ink} 16%, ${C.cacao} 36%, ${C.ink} 38%, ${C.cacao} 58%, ${C.ink} 60%, #1a0f08 100%);
    box-shadow: 0 4px 10px -6px ${C.cacao}, inset 0 0 0 1px rgba(0,0,0,0.4);
    animation: mysongs-vinyl-spin 4s linear infinite;
    flex-shrink: 0;
  }
  .mysongs-vinyl::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%);
    transform: translate(-50%, -50%);
    box-shadow: inset 0 0 0 1px rgba(43,29,20,0.5);
  }
  .mysongs-vinyl::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: ${C.paper};
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 1px rgba(43,29,20,0.6);
    z-index: 1;
  }
  /* Equalizer bars next to the title. */
  .mysongs-eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
    flex-shrink: 0;
    color: ${C.gold};
  }
  .mysongs-eq span {
    display: inline-block;
    width: 2px;
    height: 100%;
    background: currentColor;
    border-radius: 1px;
    transform-origin: bottom;
    will-change: transform;
  }
  .mysongs-eq span:nth-child(1) { animation: mysongs-eq-1 0.9s ease-in-out infinite; }
  .mysongs-eq span:nth-child(2) { animation: mysongs-eq-2 1.3s ease-in-out infinite; }
  .mysongs-eq span:nth-child(3) { animation: mysongs-eq-3 1.1s ease-in-out infinite; }
  /* Pulsing dot replacing the static "●" in the SONANDO label. */
  .mysongs-dot {
    position: relative;
    display: inline-flex;
    width: 7px;
    height: 7px;
  }
  .mysongs-dot-core {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: currentColor;
  }
  .mysongs-dot-ping {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: currentColor;
    animation: mysongs-ping 2s ease-out infinite;
  }
`;
