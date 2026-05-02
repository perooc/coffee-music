"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  housePlaylistApi,
  type HousePlaylistItem,
  type HousePlaylistValidation,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  btnPrimary,
  btnGhost,
  BUTTON_STYLES,
  pad,
  secToMin,
  timeAgo,
} from "@/lib/theme";

interface Toast {
  id: number;
  tone: "olive" | "terracotta";
  message: string;
}

/**
 * Página dedicada para curar la playlist base del bar — esa lista de
 * canciones que se reproducen automáticamente cuando ninguna mesa está
 * agregando música. Mantiene el mismo lenguaje visual que /admin/products
 * (header bebas + monospaced eyebrow + tablas premium en cream/sand).
 *
 * Flujo principal:
 *   1. Admin pega URL de YouTube en el input.
 *   2. Al perder foco (o tras 600ms de pausa al tipear) el front llama a
 *      /house-playlist/validate. Si la API devuelve metadata → preview.
 *   3. Botón "Agregar" envía POST /house-playlist (el backend re-valida).
 *   4. Lista se refresca, input se limpia, toast "Canción agregada".
 *
 * No hay drag-and-drop de reordenamiento. Para 8–20 canciones el orden
 * se gestiona con el `sort_order` que asigna el backend al crear (la nueva
 * va al final). Si llegamos a 30+ items, se agrega DnD en otra iteración.
 */
export default function HousePlaylistPage() {
  const [items, setItems] = useState<HousePlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await housePlaylistApi.list();
      setItems(data);
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      <style>{BUTTON_STYLES}</style>
      <main
        style={{
          minHeight: "100dvh",
          background: C.cream,
          color: C.ink,
          fontFamily: FONT_UI,
          padding: "20px 24px 40px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 3,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              — Crown Bar 4.90 · Música
            </span>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 26,
                color: C.ink,
                letterSpacing: 4,
                margin: "2px 0 0",
                textTransform: "uppercase",
              }}
            >
              Playlist base del bar
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 12,
                color: C.cacao,
                fontFamily: FONT_MONO,
                letterSpacing: 0.6,
                lineHeight: 1.5,
                maxWidth: 560,
              }}
            >
              Estas canciones suenan automáticamente cuando ninguna mesa tiene
              música en cola. No aparecen en la cola pública y rotan
              eligiendo la que hace más tiempo no se reproduce.
            </p>
          </div>
          <Link
            href="/admin"
            className="crown-btn crown-btn-ghost"
            style={{
              ...btnGhost({ fg: C.cacao, border: C.sand }),
              textDecoration: "none",
            }}
          >
            ← Tablero
          </Link>
        </header>

        <AddSongCard
          onAdded={(item) => {
            setItems((prev) => [...prev, item]);
            pushToast("olive", `“${item.title}” agregada a la base`);
          }}
          onError={(msg) => pushToast("terracotta", msg)}
        />

        <section style={{ marginTop: 28 }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            — Catálogo ({items.length})
          </div>

          {loading && (
            <p style={emptyStateStyle}>Cargando…</p>
          )}

          {loadError && !loading && (
            <p style={{ ...emptyStateStyle, color: C.terracotta }}>
              {loadError}
            </p>
          )}

          {!loading && !loadError && items.length === 0 && (
            <p style={emptyStateStyle}>
              Aún no has agregado canciones. Pega una URL de YouTube arriba.
            </p>
          )}

          {!loading && items.length > 0 && (
            <PlaylistTable
              items={items}
              onMutate={(updater) => setItems(updater)}
              onMessage={pushToast}
            />
          )}
        </section>
      </main>

      <ToastStack toasts={toasts} />
    </>
  );
}

// ─── Add card ────────────────────────────────────────────────────────────────

function AddSongCard({
  onAdded,
  onError,
}: {
  onAdded: (item: HousePlaylistItem) => void;
  onError: (msg: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [validating, setValidating] = useState(false);
  const [preview, setPreview] = useState<
    Extract<HousePlaylistValidation, { valid: true }> | null
  >(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>("");

  // Debounced validation: fires 500ms after the input settles. Cancels an
  // in-flight request if the URL changes before it returns by checking
  // `lastQueryRef.current` after the await.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = url.trim();
    if (!trimmed) {
      setPreview(null);
      setPreviewError(null);
      setValidating(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void validate(trimmed);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function validate(query: string) {
    lastQueryRef.current = query;
    setValidating(true);
    setPreviewError(null);
    try {
      const res = await housePlaylistApi.validate(query);
      // Stale response: the input changed while we were awaiting.
      if (lastQueryRef.current !== query) return;
      if (res.valid) {
        setPreview(res);
      } else {
        setPreview(null);
        setPreviewError(res.reason);
      }
    } catch (err) {
      if (lastQueryRef.current !== query) return;
      setPreview(null);
      setPreviewError(getErrorMessage(err));
    } finally {
      if (lastQueryRef.current === query) setValidating(false);
    }
  }

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    try {
      const res = await housePlaylistApi.create(url.trim());
      if (res.ok) {
        onAdded(res.item);
        setUrl("");
        setPreview(null);
        setPreviewError(null);
      } else {
        onError(res.message ?? "No se pudo agregar la canción");
      }
    } catch (err) {
      onError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      style={{
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 16,
        padding: "20px 22px",
        boxShadow:
          "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 3,
          color: C.mute,
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        — Agregar canción
      </div>
      <h2
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 18,
          color: C.ink,
          letterSpacing: 2,
          margin: "0 0 14px",
          textTransform: "uppercase",
        }}
      >
        Pega una URL de YouTube
      </h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 240,
            padding: "12px 14px",
            border: `1px solid ${C.sand}`,
            borderRadius: 10,
            background: C.cream,
            color: C.ink,
            fontFamily: FONT_UI,
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="button"
          className="crown-btn crown-btn-primary"
          onClick={submit}
          disabled={!preview || submitting}
          style={btnPrimary({
            bg: !preview || submitting ? C.sand : C.olive,
            fg: !preview || submitting ? C.mute : C.paper,
          })}
        >
          {submitting ? "Agregando..." : "Agregar"}
        </button>
      </div>

      <div style={{ marginTop: 14, minHeight: 60 }}>
        {validating && (
          <p
            style={{
              margin: 0,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.mute,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Validando con YouTube…
          </p>
        )}
        {!validating && previewError && (
          <p
            style={{
              margin: 0,
              padding: "10px 12px",
              border: `1px solid ${C.terracotta}33`,
              background: `${C.terracotta}11`,
              color: C.terracotta,
              borderRadius: 10,
              fontFamily: FONT_MONO,
              fontSize: 12,
              letterSpacing: 0.5,
            }}
          >
            {previewError}
          </p>
        )}
        {!validating && preview && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              border: `1px solid ${C.olive}55`,
              background: `${C.olive}0e`,
              borderRadius: 10,
            }}
          >
            {preview.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.thumbnail}
                alt=""
                width={88}
                height={66}
                style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: C.ink,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {preview.title}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.cacao,
                  marginTop: 4,
                  letterSpacing: 0.5,
                }}
              >
                {preview.artist ? `${preview.artist} · ` : ""}
                {secToMin(preview.duration)}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

function PlaylistTable({
  items,
  onMutate,
  onMessage,
}: {
  items: HousePlaylistItem[];
  onMutate: (updater: (prev: HousePlaylistItem[]) => HousePlaylistItem[]) => void;
  onMessage: (tone: "olive" | "terracotta", msg: string) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<HousePlaylistItem | null>(
    null,
  );

  async function toggleActive(item: HousePlaylistItem) {
    setBusyId(item.id);
    try {
      const updated = await housePlaylistApi.update(item.id, {
        is_active: !item.is_active,
      });
      onMutate((prev) =>
        prev.map((i) => (i.id === updated.id ? updated : i)),
      );
    } catch (err) {
      onMessage("terracotta", getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function performDelete(item: HousePlaylistItem) {
    setBusyId(item.id);
    try {
      await housePlaylistApi.remove(item.id);
      onMutate((prev) => prev.filter((i) => i.id !== item.id));
      onMessage("olive", `“${item.title}” eliminada`);
    } catch (err) {
      onMessage("terracotta", getErrorMessage(err));
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  return (
    <>
      <div
        style={{
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "44px 1fr 110px 110px 96px 110px",
            gap: 0,
            background: C.parchment,
            padding: "10px 14px",
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
            fontWeight: 700,
            borderBottom: `1px solid ${C.sand}`,
          }}
        >
          <span>#</span>
          <span>Canción</span>
          <span style={{ textAlign: "right" }}>Duración</span>
          <span style={{ textAlign: "right" }}>Última vez</span>
          <span style={{ textAlign: "center" }}>Estado</span>
          <span style={{ textAlign: "right" }}>Acciones</span>
        </div>

        {items.map((item, i) => (
          <div
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr 110px 110px 96px 110px",
              alignItems: "center",
              padding: "12px 14px",
              borderBottom:
                i === items.length - 1 ? "none" : `1px solid ${C.sand}`,
              opacity: item.is_active ? 1 : 0.55,
              transition: "opacity 0.18s ease",
            }}
          >
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 14,
                color: C.mute,
                letterSpacing: 0.5,
              }}
            >
              {pad(i + 1)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: C.ink,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.mute,
                  letterSpacing: 0.4,
                  marginTop: 2,
                }}
              >
                {item.artist ?? item.youtube_id}
              </div>
            </div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: C.cacao,
                textAlign: "right",
                letterSpacing: 0.5,
              }}
            >
              {secToMin(item.duration)}
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                textAlign: "right",
                letterSpacing: 0.5,
              }}
            >
              {item.last_played_at ? timeAgo(item.last_played_at) : "Nunca"}
            </span>
            <div style={{ textAlign: "center" }}>
              <button
                type="button"
                onClick={() => toggleActive(item)}
                disabled={busyId === item.id}
                className="crown-btn crown-btn-ghost"
                style={{
                  ...btnGhost({
                    fg: item.is_active ? C.olive : C.mute,
                    border: item.is_active ? C.olive : C.sand,
                  }),
                  fontSize: 10,
                  letterSpacing: 1.5,
                  padding: "4px 10px",
                }}
              >
                {item.is_active ? "Activa" : "Inactiva"}
              </button>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 6,
              }}
            >
              <a
                href={`https://www.youtube.com/watch?v=${item.youtube_id}`}
                target="_blank"
                rel="noreferrer"
                className="crown-btn crown-btn-ghost"
                style={{
                  ...btnGhost({ fg: C.mute, border: C.sand }),
                  textDecoration: "none",
                  fontSize: 11,
                  padding: "4px 8px",
                }}
                title="Ver en YouTube"
              >
                ↗
              </a>
              <button
                type="button"
                onClick={() => setConfirmDelete(item)}
                disabled={busyId === item.id}
                className="crown-btn crown-btn-ghost"
                style={{
                  ...btnGhost({ fg: C.terracotta, border: C.sand }),
                  fontSize: 11,
                  padding: "4px 8px",
                }}
                title="Eliminar"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDelete
          item={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => performDelete(confirmDelete)}
        />
      )}
    </>
  );
}

function ConfirmDelete({
  item,
  onCancel,
  onConfirm,
}: {
  item: HousePlaylistItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Eliminar canción"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.terracotta,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Eliminar
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              color: C.ink,
              letterSpacing: 1.5,
              margin: "4px 0 0",
              textTransform: "uppercase",
            }}
          >
            ¿Quitar esta canción?
          </h3>
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: FONT_UI,
            fontSize: 14,
            color: C.cacao,
            lineHeight: 1.5,
          }}
        >
          “{item.title}” saldrá de la playlist base. Las próximas veces que
          el bar quede sin música no la elegirá.
        </p>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="crown-btn crown-btn-ghost"
            style={btnGhost({ fg: C.cacao, border: C.sand })}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="crown-btn crown-btn-primary"
            style={btnPrimary({ bg: C.terracotta, fg: C.paper })}
          >
            Sí, eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: 18,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: t.tone === "olive" ? C.olive : C.terracotta,
            color: C.paper,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            padding: "10px 16px",
            borderRadius: 999,
            boxShadow: "0 10px 30px -10px rgba(43,29,20,0.45)",
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

const emptyStateStyle: React.CSSProperties = {
  margin: 0,
  padding: "32px 18px",
  textAlign: "center",
  fontFamily: FONT_MONO,
  fontSize: 12,
  color: C.mute,
  letterSpacing: 1,
  background: C.paper,
  border: `1px dashed ${C.sand}`,
  borderRadius: 12,
};
