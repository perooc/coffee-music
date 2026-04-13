"use client";

import { useState, useRef, useEffect } from "react";
import { musicApi, queueApi } from "@/lib/api/services";
import type { YouTubeSearchResult } from "@coffee-bar/shared";
import { MAX_SONG_DURATION_SECONDS } from "@coffee-bar/shared";

const pad = (n: number) => String(n).padStart(2, "0");
const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

interface SongSearchProps {
  tableId: number;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export default function SongSearch({
  tableId,
  open,
  onClose,
  onAdded,
}: SongSearchProps) {
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

  const search = async (q: string) => {
    if (q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const data = await musicApi.search(q);
      setResults(data);
    } catch {
      setError("Error al buscar. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 400);
  };

  const handleAdd = async (result: YouTubeSearchResult) => {
    if (result.duration > MAX_SONG_DURATION_SECONDS) {
      setError(
        `Máximo ${secToMin(MAX_SONG_DURATION_SECONDS)}. Esta canción dura ${secToMin(result.duration)}.`,
      );
      return;
    }

    setAdding(result.youtubeId);
    setError(null);
    try {
      await queueApi.addSong({
        youtube_id: result.youtubeId,
        title: result.title,
        duration: result.duration,
        table_id: tableId,
      });
      onAdded();
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response
              ?.data?.message
          : null;
      setError(msg ?? "No se pudo agregar la canción.");
    } finally {
      setAdding(null);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #1a1a1a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "'Bebas Neue',Impact,sans-serif",
            fontSize: 18,
            letterSpacing: 3,
            color: "#f5f5f5",
          }}
        >
          BUSCAR CANCIÓN
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid #2a2a2a",
            color: "#555",
            padding: "4px 12px",
            fontFamily: "monospace",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          CERRAR
        </button>
      </div>

      {/* Search input */}
      <div style={{ padding: "16px 20px" }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Nombre de canción o artista..."
          style={{
            width: "100%",
            padding: "14px 16px",
            background: "#111",
            border: "1px solid #2a2a2a",
            color: "#f5f5f5",
            fontFamily: "monospace",
            fontSize: 14,
            outline: "none",
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "0 20px 12px",
            color: "#ef4444",
            fontFamily: "monospace",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
        {loading && (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "#555",
              fontFamily: "monospace",
              fontSize: 11,
              letterSpacing: 2,
            }}
          >
            BUSCANDO...
          </p>
        )}

        {!loading && query.length >= 2 && results.length === 0 && (
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
            SIN RESULTADOS
          </p>
        )}

        {results.map((r) => {
          const tooLong = r.duration > MAX_SONG_DURATION_SECONDS;
          const isAdding = adding === r.youtubeId;

          return (
            <div
              key={r.youtubeId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid #111",
                opacity: tooLong ? 0.4 : 1,
              }}
            >
              {r.thumbnail && (
                <img
                  src={r.thumbnail}
                  alt=""
                  style={{
                    width: 48,
                    height: 36,
                    objectFit: "cover",
                    borderRadius: 2,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "'Bebas Neue',Impact,sans-serif",
                    fontSize: 13,
                    color: "#f5f5f5",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: tooLong ? "#ef4444" : "#444",
                    fontFamily: "monospace",
                  }}
                >
                  {secToMin(r.duration)}
                  {tooLong && " · EXCEDE LÍMITE"}
                </div>
              </div>
              <button
                onClick={() => handleAdd(r)}
                disabled={tooLong || isAdding}
                style={{
                  background: tooLong
                    ? "#1a1a1a"
                    : isAdding
                      ? "#333"
                      : "#FFDC32",
                  border: "none",
                  color: tooLong || isAdding ? "#555" : "#0a0a0a",
                  padding: "6px 14px",
                  fontFamily: "'Bebas Neue',Impact,sans-serif",
                  fontSize: 11,
                  letterSpacing: 2,
                  cursor: tooLong || isAdding ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {isAdding ? "..." : tooLong ? "—" : "AGREGAR"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
