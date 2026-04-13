"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { SocketEvents } from "@coffee-bar/shared";

// ─── Singleton ────────────────────────────────────────────────────────────────
let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001", {
      transports: ["websocket"],
      autoConnect: false,
    });

    socket.on("connect", () => {
      console.log("[Socket] conectado →", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.warn("[Socket] desconectado →", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] error →", err.message);
    });
  }
  return socket;
}

// ─── Tipos de listeners ───────────────────────────────────────────────────────
type SocketListener<K extends keyof SocketEvents> = (
  payload: SocketEvents[K],
) => void;

// ─── Opciones del hook ────────────────────────────────────────────────────────
interface UseSocketOptions {
  tableId?: number;
  onQueueUpdated?: SocketListener<"queue:updated">;
  onTableUpdated?: SocketListener<"table:updated">;
  onOrderUpdated?: SocketListener<"order:updated">;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSocket(options: UseSocketOptions = {}) {
  const { tableId, onQueueUpdated, onTableUpdated, onOrderUpdated } = options;
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    if (!s.connected) s.connect();

    if (tableId !== undefined) {
      s.emit("table:join", tableId);
    }

    if (onQueueUpdated) s.on("queue:updated", onQueueUpdated);
    if (onTableUpdated) s.on("table:updated", onTableUpdated);
    if (onOrderUpdated) s.on("order:updated", onOrderUpdated);

    return () => {
      if (onQueueUpdated) s.off("queue:updated", onQueueUpdated);
      if (onTableUpdated) s.off("table:updated", onTableUpdated);
      if (onOrderUpdated) s.off("order:updated", onOrderUpdated);
    };
  }, [tableId, onQueueUpdated, onTableUpdated, onOrderUpdated]);

  // ─── Acciones ─────────────────────────────────────────────────────────────
  const requestSong = useCallback((payload: SocketEvents["song:request"]) => {
    socketRef.current?.emit("song:request", payload);
  }, []);

  const isConnected = useCallback(
    () => socketRef.current?.connected ?? false,
    [],
  );

  return { requestSong, isConnected };
}
