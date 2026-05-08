"use client";

/**
 * Panel de música — sidebar derecho del admin.
 *
 * Reemplaza la barra horizontal de playback que ocupaba todo el ancho del
 * top. Aquí concentramos TODO lo relacionado con música (now-playing,
 * cola, controles, agregar) en una zona contenida que el operador puede
 * colapsar cuando no está enfocado en el dominio musical.
 *
 * Dos estados:
 *   - Expandido (default, 340px): now-playing card + 5 últimos en cola
 *     + controles. La cola es scroll-corto (no compite con las columnas
 *     centrales por scroll vertical).
 *   - Colapsado (~56px): tira angosta con el botón de expandir + un dot
 *     pulsante si hay reproducción activa. Sin perder señal visual.
 *
 * El estado vive en localStorage para que el operador no tenga que
 * decidirlo cada vez que abre el panel.
 */

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import type { PlaybackState, QueueItem } from "@coffee-bar/shared";
import { accessCodeApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  DUR_BASE,
  DUR_SLOW,
  pad,
  btnPrimary,
  btnGhost,
} from "@/lib/theme";

const STORAGE_KEY = "crown.admin.musicPanel.collapsed";

interface Props {
  playback: PlaybackState | null;
  queue: QueueItem[];
  onPlayNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
  onSkipQueueItem: (id: number) => void;
  onAdd: () => void;
  actionInProgress: string | null;
}

export function MusicPanel(props: Props) {
  // Lazy initializer: leemos localStorage solo en el primer render del
  // cliente. El componente está en `<motion.aside>` dentro de `"use client"`,
  // así que el primer render ya es client-side y no hay riesgo de SSR
  // mismatch. Esto evita el setState-in-effect que React 19 marca como
  // smell, y arranca con el estado correcto sin un flash de "expandido".
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // no-op
      }
      return next;
    });
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 56 : 340 }}
      transition={{ duration: DUR_SLOW / 1000, ease: [0.16, 1, 0.3, 1] }}
      style={{
        flexShrink: 0,
        borderLeft: `1px solid ${C.sand}`,
        background: C.paper,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {collapsed ? (
          <CollapsedView
            key="collapsed"
            playback={props.playback}
            onExpand={toggle}
          />
        ) : (
          <ExpandedView
            key="expanded"
            {...props}
            onCollapse={toggle}
          />
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

// ─── Colapsado ─────────────────────────────────────────────────────────────

function CollapsedView({
  playback,
  onExpand,
}: {
  playback: PlaybackState | null;
  onExpand: () => void;
}) {
  const isPlaying = playback?.status === "playing" && Boolean(playback.song);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DUR_BASE / 1000 }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
        gap: 12,
      }}
    >
      <button
        onClick={onExpand}
        aria-label="Expandir panel de música"
        title="Expandir panel de música"
        className="crown-btn crown-btn-ghost"
        style={{
          ...btnGhost({ fg: C.cacao, border: C.sand }),
          width: 36,
          height: 36,
          padding: 0,
          fontSize: 18,
          fontFamily: FONT_UI,
          fontWeight: 700,
        }}
      >
        ♪
      </button>
      {isPlaying && (
        <span
          aria-label="Reproducción activa"
          style={{
            position: "relative",
            display: "inline-flex",
            width: 10,
            height: 10,
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              background: C.olive,
              opacity: 0.55,
              animation: "crown-ping 1.8s ease-out infinite",
            }}
          />
          <span
            style={{
              position: "relative",
              width: 10,
              height: 10,
              borderRadius: 999,
              background: C.olive,
            }}
          />
        </span>
      )}
      <div
        style={{
          flex: 1,
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 3,
          color: C.mute,
          fontWeight: 700,
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        Música
      </div>
    </motion.div>
  );
}

// ─── Expandido ─────────────────────────────────────────────────────────────

function ExpandedView({
  playback,
  queue,
  onPlayNext,
  onSkip,
  onFinish,
  onSkipQueueItem,
  onAdd,
  actionInProgress,
  onCollapse,
}: Props & { onCollapse: () => void }) {
  const isPlaying = playback?.status === "playing" && Boolean(playback.song);
  const pendingQueue = queue
    .filter((q) => q.status === "pending")
    .slice(0, 5);
  const hasPending = pendingQueue.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: DUR_BASE / 1000, ease: [0.16, 1, 0.3, 1] }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "14px 16px 10px",
          borderBottom: `1px solid ${C.sand}`,
          background: `linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%)`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 3,
              color: C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            — Audio
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 20,
              color: C.ink,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Música
          </div>
        </div>
        <button
          onClick={onCollapse}
          aria-label="Colapsar panel de música"
          title="Colapsar"
          className="crown-btn crown-btn-ghost"
          style={{
            ...btnGhost({ fg: C.cacao, border: C.sand }),
            padding: "5px 10px",
            fontSize: 14,
          }}
        >
          →
        </button>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <NowPlayingCard playback={playback} />

        {/* Controles principales */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {!isPlaying && hasPending && (
            <button
              className="crown-btn crown-btn-primary"
              onClick={onPlayNext}
              disabled={actionInProgress !== null}
              style={btnPrimary({
                bg: actionInProgress === "play" ? C.sand : C.olive,
                fg: actionInProgress === "play" ? C.mute : C.paper,
                fullWidth: true,
              })}
            >
              {actionInProgress === "play" ? "INICIANDO..." : "▶ REPRODUCIR SIGUIENTE"}
            </button>
          )}
          {isPlaying && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="crown-btn crown-btn-primary"
                onClick={onSkip}
                disabled={actionInProgress !== null}
                style={btnPrimary({
                  bg: actionInProgress === "skip" ? C.sand : C.gold,
                  fg: actionInProgress === "skip" ? C.mute : C.paper,
                  fullWidth: true,
                })}
              >
                {actionInProgress === "skip" ? "SALTANDO..." : "SALTAR"}
              </button>
              <button
                className="crown-btn crown-btn-ghost"
                onClick={onFinish}
                disabled={actionInProgress !== null}
                style={btnGhost({ fg: C.cacao, border: C.sand })}
              >
                {actionInProgress === "finish" ? "..." : "FINALIZAR"}
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="crown-btn crown-btn-primary"
              onClick={onAdd}
              style={btnPrimary({ bg: C.olive, fg: C.paper, fullWidth: true })}
            >
              + AGREGAR
            </button>
            <a
              href="/player"
              target="_blank"
              rel="noreferrer"
              className="crown-btn crown-btn-ghost"
              style={{
                ...btnGhost({ fg: C.cacao, border: C.sand }),
                textDecoration: "none",
              }}
            >
              ⤢
            </a>
          </div>
          <AccessCodeWidget />

          {/* Discreet shortcut to manage the bar's fallback playlist
              (the "house" songs that auto-fill when no customer queues
              anything). Lives here so it's contextually grouped with all
              music actions, but it's a secondary action so it goes ghost. */}
          <a
            href="/admin/musica-base"
            className="crown-btn crown-btn-ghost"
            style={{
              ...btnGhost({ fg: C.mute, border: C.sand }),
              textDecoration: "none",
              fontSize: 10,
              letterSpacing: 1.5,
              padding: "6px 10px",
              textAlign: "center",
              fontFamily: FONT_MONO,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            ♪ Música base del bar
          </a>
        </div>

        {/* Cola corta */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 3,
                color: C.mute,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              Próximas
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.cacao,
                fontWeight: 700,
              }}
            >
              {pendingQueue.length}
              {queue.filter((q) => q.status === "pending").length > 5
                ? "/" + queue.filter((q) => q.status === "pending").length
                : ""}
            </span>
          </div>
          {pendingQueue.length === 0 ? (
            <div
              style={{
                padding: "14px 12px",
                background: C.parchment,
                borderRadius: 10,
                color: C.mute,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 1.5,
                textAlign: "center",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Cola vacía
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <AnimatePresence initial={false}>
                {pendingQueue.map((item, i) => (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{
                      duration: DUR_BASE / 1000,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    <QueueRow
                      item={item}
                      position={i + 1}
                      onSkip={() => onSkipQueueItem(item.id)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Now Playing card ──────────────────────────────────────────────────────

function NowPlayingCard({ playback }: { playback: PlaybackState | null }) {
  const isPlaying = playback?.status === "playing" && Boolean(playback.song);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        border: `1px solid ${isPlaying ? C.goldSoft : C.sand}`,
        background: isPlaying
          ? `linear-gradient(135deg, color-mix(in srgb, ${C.goldSoft} 35%, ${C.paper}) 0%, ${C.paper} 70%)`
          : C.paper,
        padding: 14,
        boxShadow: isPlaying ? C.shadowLift : C.shadow,
        overflow: "hidden",
      }}
    >
      {/* Sweep dorado animado en el borde superior */}
      {isPlaying && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, transparent 0%, ${C.gold} 50%, transparent 100%)`,
            transform: "translateX(-100%)",
            animation: "crown-sweep 3.2s ease-in-out infinite",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Vinyl artwork */}
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            background: isPlaying
              ? `radial-gradient(circle at 50% 50%, ${C.paper} 0%, ${C.paper} 14%, transparent 14%), radial-gradient(circle at 50% 50%, ${C.cacao} 16%, ${C.ink} 18%, ${C.cacao} 38%, ${C.ink} 40%, ${C.cacao} 60%, ${C.ink} 62%, #1a0f08 100%)`
              : C.sand,
            boxShadow: isPlaying
              ? `0 8px 18px -10px ${C.cacao}, inset 0 0 0 1px rgba(0,0,0,0.4)`
              : "none",
            animation: isPlaying ? "crown-vinyl-spin 4s linear infinite" : undefined,
            flexShrink: 0,
          }}
        />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 2.5,
              color: isPlaying ? C.gold : C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isPlaying ? "♪ Sonando" : "En silencio"}
            {isPlaying && (
              <span
                style={{
                  display: "inline-flex",
                  gap: 1.5,
                  alignItems: "flex-end",
                  height: 9,
                }}
              >
                <span
                  style={{
                    width: 2,
                    background: C.gold,
                    transformOrigin: "bottom",
                    animation: "crown-eq-1 0.9s ease-in-out infinite",
                  }}
                />
                <span
                  style={{
                    width: 2,
                    background: C.gold,
                    transformOrigin: "bottom",
                    animation: "crown-eq-2 1.2s ease-in-out infinite",
                  }}
                />
                <span
                  style={{
                    width: 2,
                    background: C.gold,
                    transformOrigin: "bottom",
                    animation: "crown-eq-3 0.7s ease-in-out infinite",
                  }}
                />
              </span>
            )}
          </div>
          {isPlaying ? (
            <>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 15,
                  color: C.ink,
                  letterSpacing: 0.5,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={playback.song?.title}
              >
                {playback.song?.title}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.cacao,
                  letterSpacing: 1,
                  marginTop: 2,
                  fontWeight: 600,
                }}
              >
                {playback.table_id ? `Mesa ${pad(playback.table_id)}` : "ADMIN"}
              </div>
            </>
          ) : (
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Sin reproducción
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Queue row ─────────────────────────────────────────────────────────────

function QueueRow({
  item,
  position,
  onSkip,
}: {
  item: QueueItem;
  position: number;
  onSkip: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 10,
      }}
    >
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 14,
          color: C.gold,
          letterSpacing: 0.5,
          minWidth: 20,
          flexShrink: 0,
        }}
      >
        {position}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 12,
            color: C.ink,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.2,
          }}
          title={item.song?.title}
        >
          {item.song?.title ?? "—"}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.mute,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            fontWeight: 600,
            marginTop: 1,
          }}
        >
          {item.table_id ? `Mesa ${pad(item.table_id)}` : "ADMIN"}
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        aria-label="Saltar de la cola"
        className="crown-btn crown-btn-ghost crown-btn-ghost-danger"
        style={{
          ...btnGhost({ fg: C.terracotta, border: C.terracotta }),
          padding: "4px 9px",
          fontSize: 10,
          letterSpacing: 0.4,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Access code widget ────────────────────────────────────────────────────
// The 4-digit code customers must type once per device before opening a
// session. We expose it inline in the music panel so the staff can read
// it out loud or write it on a whiteboard, and rotate it on demand
// (e.g. when a customer leaves and we want their copy to stop working).
function AccessCodeWidget() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await accessCodeApi.getCurrent();
        if (!cancelled) {
          setCode(data.code);
          setExpiresAt(data.expires_at);
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      }
    };
    load();
    // Refresh once a minute so the "expires in" countdown stays
    // honest even if the staff leaves the dashboard open all night.
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Auto-dismiss the success toast after a beat — it's a pure
  // confirmation cue, the canonical state is the code rendered above.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  const performRotate = async () => {
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      const data = await accessCodeApi.rotate();
      setCode(data.code);
      setExpiresAt(data.expires_at);
      setToast(`Nuevo código generado: ${data.code}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 12px",
        background: `${C.gold}0e`,
        border: `1px solid ${C.gold}55`,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 2.5,
              color: C.gold,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            — Código del bar
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 30,
              color: C.ink,
              letterSpacing: 8,
              lineHeight: 1,
              marginTop: 2,
            }}
            aria-live="polite"
          >
            {code ?? "····"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          className="crown-btn crown-btn-ghost"
          style={{
            ...btnGhost({ fg: C.cacao, border: C.sand }),
            fontSize: 10,
            padding: "6px 10px",
            letterSpacing: 1.2,
            whiteSpace: "nowrap",
          }}
          title="Generar un código nuevo"
        >
          ↻ Rotar
        </button>
      </div>
      {error && (
        <span
          role="alert"
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.terracotta,
            letterSpacing: 0.4,
          }}
        >
          {error}
        </span>
      )}
      {!error && expiresAt && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.mute,
            letterSpacing: 0.4,
          }}
        >
          Vence: {new Date(expiresAt).toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}

      {confirmOpen && (
        <RotateConfirmModal
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={performRotate}
        />
      )}
      {toast && <RotateToast text={toast} />}
    </div>
  );
}

function RotateConfirmModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar rotación de código"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(43,29,20,0.45)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 360,
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 16,
          padding: "22px 22px 18px",
          boxShadow: "0 30px 80px -30px rgba(43,29,20,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 3,
            color: C.gold,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          — Código del bar
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 22,
            color: C.ink,
            letterSpacing: 1,
            lineHeight: 1.1,
          }}
        >
          ¿Generar un nuevo código?
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: C.cacao,
            lineHeight: 1.5,
          }}
        >
          El código actual dejará de funcionar. Los clientes con sesión
          abierta no se ven afectados; solo los nuevos accesos.
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="crown-btn crown-btn-ghost"
            style={{
              ...btnGhost({ fg: C.cacao, border: C.sand }),
              fontSize: 11,
              padding: "8px 14px",
              letterSpacing: 1.2,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="crown-btn"
            style={{
              border: "none",
              borderRadius: 999,
              padding: "8px 16px",
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              color: C.paper,
              background: busy
                ? C.sand
                : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Generando..." : "Generar nuevo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RotateToast({ text }: { text: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1100,
        padding: "10px 16px",
        background: C.ink,
        color: C.paper,
        borderRadius: 999,
        fontFamily: FONT_MONO,
        fontSize: 12,
        letterSpacing: 0.6,
        boxShadow: "0 18px 40px -18px rgba(43,29,20,0.6)",
      }}
    >
      ✓ {text}
    </div>
  );
}
