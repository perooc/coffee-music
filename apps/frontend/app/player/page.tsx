"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminPlaybackPlayer } from "@/components/music/AdminPlaybackPlayer";
import { accessCodeApi, playbackApi, queueApi } from "@/lib/api/services";
import { useSocket } from "@/lib/socket/useSocket";
import { useAppStore } from "@/store";
import type { PlaybackState, QueueItem } from "@coffee-bar/shared";

// ─── Dark stadium palette (landing-aligned) ──────────────────────────────────
const D = {
  midnight: "#0B0F14",
  pitch: "#0E2A1F",
  gold: "#E9B949",
  goldHot: "#F6CF6A",
  cream: "#F5EFE2",
  burgundy: "#8B2635",
  chalk: "rgba(245,239,.,0.08)",
  mute: "rgba(245,239,.,0.55)",
};
const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
const FONT_UI = "var(--font-manrope), system-ui, sans-serif";
const FONT_MONO = "var(--font-oswald), 'Oswald', ui-monospace, monospace";

export default function PlayerPage() {
  const autoplayRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const { currentPlayback, setCurrentPlayback, queue, updateFromSocket } =
    useAppStore();

  const handleQueueUpdated = useCallback(
    (items: QueueItem[]) => updateFromSocket(items),
    [updateFromSocket],
  );

  const handlePlaybackUpdated = useCallback(
    (playback: PlaybackState) => setCurrentPlayback(playback),
    [setCurrentPlayback],
  );

  useSocket({
    onQueueUpdated: handleQueueUpdated,
    onPlaybackUpdated: handlePlaybackUpdated,
  });

  useEffect(() => {
    Promise.all([
      queueApi.getGlobal().then(updateFromSocket),
      playbackApi.getCurrent().then(setCurrentPlayback),
    ])
      .catch(console.error)
      .finally(() => setLoaded(true));
  }, [setCurrentPlayback, updateFromSocket]);

  const handlePlaybackEnded = useCallback(async () => {
    if (autoplayRef.current) return;
    autoplayRef.current = true;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await queueApi.advanceToNext();
        break;
      } catch (error) {
        console.error(`[autoplay] advance failed (attempt ${attempt + 1}):`, error);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    autoplayRef.current = false;
  }, []);

  useEffect(() => {
    if (!loaded) return;

    const hasPendingSongs = queue.some((item) => item.status === "pending");
    const isIdle = !currentPlayback || currentPlayback.status === "idle";

    if (!hasPendingSongs || !isIdle || autoplayRef.current) return;

    autoplayRef.current = true;
    queueApi
      .advanceToNext()
      .catch(console.error)
      .finally(() => {
        autoplayRef.current = false;
      });
  }, [currentPlayback, queue]);

  const status = currentPlayback?.status;

  const statusLabel =
    status === "buffering"
      ? "CARGANDO..."
      : status === "playing"
        ? "SONANDO AHORA"
        : status === "paused"
          ? "PAUSADO"
          : "ESPERANDO CANCIÓN";

  const statusTag =
    status === "buffering"
      ? "BUFFERING"
      : status === "playing"
        ? "REPRODUCCIÓN ACTIVA"
        : status === "paused"
          ? "PAUSADO"
          : "IDLE";

  const statusColor =
    status === "playing"
      ? D.gold
      : status === "buffering" || status === "paused"
        ? D.goldHot
        : D.mute;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        html, body { background: ${D.midnight}; color: ${D.cream}; }
        @keyframes crown-player-ping {
          0%   { transform: scale(1);   opacity: 0.55; }
          80%  { transform: scale(2.4); opacity: 0;    }
          100% { transform: scale(2.4); opacity: 0;    }
        }
        .crown-player-grain::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.12;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
          background-size: 240px 240px;
        }
      `}</style>

      <main
        style={{
          position: "relative",
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          fontFamily: FONT_UI,
          color: D.cream,
          background: `
            radial-gradient(ellipse at 50% 0%, rgba(14,42,31,0.75) 0%, transparent 55%),
            radial-gradient(ellipse at 85% 90%, rgba(233,185,73,0.08) 0%, transparent 50%),
            ${D.midnight}
          `,
          overflow: "hidden",
        }}
        className="crown-player-grain"
      >
        <PlayerAccessCode />
        {/* Watermark logo */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt=""
            style={{
              width: "min(55vw, 720px)",
              height: "auto",
              opacity: 0.08,
              mixBlendMode: "screen",
              filter: "saturate(1.2) contrast(1.1)",
              userSelect: "none",
            }}
            draggable={false}
          />
        </div>

        {/* Pitch lines — subtle stadium texture */}
        <svg
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            opacity: 0.35,
            zIndex: 0,
          }}
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id="playerFade" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(245,239,.,0)" />
              <stop offset="50%" stopColor="rgba(245,239,.,0.15)" />
              <stop offset="100%" stopColor="rgba(245,239,.,0.04)" />
            </linearGradient>
          </defs>
          <g stroke="url(#playerFade)" strokeWidth={1.2} fill="none">
            <circle cx="800" cy="450" r="140" />
            <circle cx="800" cy="450" r="3" fill="rgba(245,239,.,0.35)" />
            <line x1="0" y1="450" x2="1600" y2="450" />
          </g>
        </svg>

        {/* Header */}
        <header
          style={{
            position: "relative",
            zIndex: 2,
            padding: "22px 36px",
            borderBottom: `1px solid ${D.chalk}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            background: `linear-gradient(180deg, rgba(11,15,20,0.85) 0%, transparent 100%)`,
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Crown Bar 4.90"
              style={{
                height: 56,
                width: "auto",
                mixBlendMode: "screen",
                filter: "saturate(1.15)",
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: D.mute,
                  letterSpacing: 3,
                  fontFamily: FONT_MONO,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                — Pantalla de reproducción
              </div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 32,
                  color: D.cream,
                  letterSpacing: 3,
                  lineHeight: 1,
                  textTransform: "uppercase",
                }}
              >
                {statusLabel}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 14px",
              borderRadius: 999,
              border: `1px solid ${status === "playing" ? D.gold : D.chalk}`,
              background: status === "playing" ? "rgba(233,185,73,0.12)" : "transparent",
              color: statusColor,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            <span style={{ position: "relative", display: "inline-flex", width: 9, height: 9 }}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: statusColor,
                  animation: status === "playing" ? "crown-player-ping 2s ease-out infinite" : "none",
                  opacity: status === "playing" ? 0.55 : 0,
                }}
              />
              <span
                style={{
                  position: "relative",
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: "currentColor",
                }}
              />
            </span>
            {statusTag}
          </div>
        </header>

        {/* Player surface */}
        <section
          style={{
            position: "relative",
            zIndex: 2,
            flex: 1,
            display: "flex",
            alignItems: "stretch",
            padding: 36,
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              borderRadius: 20,
              overflow: "hidden",
              border: `1px solid ${D.chalk}`,
              background: "rgba(11,15,20,0.65)",
              boxShadow:
                "0 40px 80px -30px rgba(0,0,0,0.85), 0 0 0 1px rgba(233,185,73,0.06)",
            }}
          >
            <AdminPlaybackPlayer
              playback={currentPlayback}
              onPlaybackEnded={handlePlaybackEnded}
              mode="screen"
            />
          </div>
        </section>
      </main>
    </>
  );
}

/**
 * The 4-digit bar code, pinned to the top-right of the player TV. The
 * customer screen scans the QR → ends up at the access-code gate → and
 * here we show the same code that the gate is waiting for. Refreshes
 * itself once a minute (the code rotates lazily on the backend; this
 * widget only displays whatever's currently active).
 */
function PlayerAccessCode() {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await accessCodeApi.getForDisplay();
        if (!cancelled) setCode(data.code);
      } catch {
        // Public endpoint, but don't crash the whole player if it fails.
        if (!cancelled) setCode(null);
      }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!code) return null;

  return (
    <div
      aria-label="Código del bar"
      style={{
        // Sits in normal flow at the top of the header instead of
        // floating absolutely — that way it can't overlap the playback
        // frame's title/duration overlay no matter the screen ratio.
        position: "absolute",
        top: 22,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: "rgba(11,15,20,0.7)",
        border: `1px solid ${D.gold}33`,
        borderRadius: 999,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: "0 12px 30px -12px rgba(0,0,0,0.7)",
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 2.5,
          color: D.gold,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        Código del bar
      </span>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 22,
          color: D.cream,
          letterSpacing: 6,
          lineHeight: 1,
        }}
      >
        {code}
      </span>
    </div>
  );
}
