"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { SocketEvents } from "@coffee-bar/shared";
import {
  getAdminToken,
  getSessionToken,
} from "@/lib/auth/token-storage";

// ─── Singleton ────────────────────────────────────────────────────────────────
let socket: Socket | null = null;

function resolveSocketUrl() {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    return `${protocol}//${hostname}:3001`;
  }

  return "http://localhost:3001";
}

/**
 * The socket.io middleware on the server reads `handshake.auth.token`.
 * We prefer an admin token (staff panel / player — actually: only the admin
 * panel, the player is anonymous) and fall back to a session token
 * (customer QR flow). Anonymous connections are legal and just land in the
 * global channel.
 *
 * Using a function so reconnects pick up a token that was minted after the
 * first connect attempt (e.g. the user opens their session after the
 * player already connected anonymously).
 */
function resolveSocketAuth(): { token?: string } {
  // En la app de mesa (`/mesa/[id]`) el cliente es un comensal, no un
  // operador. Si por casualidad el dispositivo tiene un admin_token
  // viejo en localStorage (porque ese mismo navegador alguna vez se
  // logueó al admin), preferirlo sobre el session_token le manda al
  // backend un token expirado/invalido y el socket nunca conecta.
  // Por eso en `/mesa/*` forzamos session_token.
  const isMesaSurface =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/mesa/");
  if (isMesaSurface) {
    const session = getSessionToken();
    if (session) return { token: session };
    return {};
  }
  const admin = getAdminToken();
  if (admin) return { token: admin };
  const session = getSessionToken();
  if (session) return { token: session };
  return {};
}

function getSocket(): Socket {
  if (!socket) {
    socket = io(resolveSocketUrl(), {
      transports: ["websocket"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (cb) => cb(resolveSocketAuth()),
    });

    socket.on("connect", () => {
      console.log("[Socket] conectado →", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.warn("[Socket] desconectado →", reason);
    });

    // Transient connect errors (browser suspended the tab, brief network
    // hiccup, etc.) are expected — socket.io will reconnect on its own.
    // We only want a hard failure surface, so log at debug level here and
    // escalate only if `reconnect_failed` actually fires.
    socket.on("connect_error", (err) => {
      console.debug("[Socket] error de conexión →", err.message);
    });

    socket.io.on("reconnect", (attempt) => {
      console.log(`[Socket] reconectado después de ${attempt} intentos`);
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      if (attempt <= 3 || attempt % 5 === 0) {
        console.debug(`[Socket] reintentando conexión (intento ${attempt})...`);
      }
    });

    socket.io.on("reconnect_failed", () => {
      console.error("[Socket] no se pudo reconectar — se rinde");
    });
  }
  return socket;
}

/**
 * Force the socket to reconnect with the latest auth payload. Used
 * after acquiring a fresh session_token (e.g. a second device joining
 * an existing table) so the server upgrades the anonymous connection
 * to an authenticated one and lets `tableSession:join` succeed.
 *
 * Safe to call before the socket has been created — it'll be a no-op
 * and the next `getSocket()` will pick the auth up naturally.
 */
export function reconnectSocketWithFreshAuth() {
  if (!socket) return;
  // Disconnect → connect: the second connect re-invokes the auth
  // callback, which now returns the up-to-date token.
  socket.disconnect();
  socket.connect();
}

type SocketListener<K extends keyof SocketEvents> = (
  payload: SocketEvents[K],
) => void;

interface UseSocketOptions {
  /**
   * Join the session room `tableSession:{id}`. Customer views pass this so
   * they receive bill, order, order-request and session lifecycle events for
   * their own visit only.
   */
  sessionId?: number;
  /**
   * Join the staff room. Today the staff channel is broadcast (pre-auth), so
   * this only affects room membership, not delivery. It future-proofs the UI
   * for when the staff channel gates by auth.
   */
  staff?: boolean;
  /**
   * Legacy per-table room. Kept for back-compat with any client still
   * subscribing by raw table id. New code should use `sessionId` instead.
   */
  tableId?: number;

  onQueueUpdated?: SocketListener<"queue:updated">;
  onPlaybackUpdated?: SocketListener<"playback:updated">;
  onTableUpdated?: SocketListener<"table:updated">;

  onBillUpdated?: SocketListener<"bill:updated">;
  onOrderCreated?: SocketListener<"order:created">;
  onOrderUpdated?: SocketListener<"order:updated">;
  onOrderRequestCreated?: SocketListener<"order-request:created">;
  onOrderRequestUpdated?: SocketListener<"order-request:updated">;
  onTableSessionOpened?: SocketListener<"table-session:opened">;
  onTableSessionUpdated?: SocketListener<"table-session:updated">;
  onTableSessionClosed?: SocketListener<"table-session:closed">;
  /**
   * Batch de productos cuyo stock, precio, estado o receta cambió.
   * Las vistas que mantienen un catálogo en memoria (mesa, admin
   * productos) deben hacer merge por id sin recargar todo.
   */
  onProductUpdated?: SocketListener<"product:updated">;
  onReconnect?: () => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const {
    sessionId,
    staff,
    tableId,
    onQueueUpdated,
    onPlaybackUpdated,
    onTableUpdated,
    onBillUpdated,
    onOrderCreated,
    onOrderUpdated,
    onOrderRequestCreated,
    onOrderRequestUpdated,
    onTableSessionOpened,
    onTableSessionUpdated,
    onTableSessionClosed,
    onProductUpdated,
    onReconnect,
  } = options;
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;

    if (!s.connected) s.connect();

    // Join rooms on connect and re-join on reconnect.
    const joinRooms = () => {
      // Debug visible para Eruda: queremos saber EXACTAMENTE qué
      // rooms se intentan unir cada vez que el socket conecta.
      console.log("[Socket] joinRooms()", {
        sessionId,
        staff,
        tableId,
        connected: s.connected,
        socketId: s.id,
      });
      if (sessionId !== undefined) {
        console.log("[Socket] emit tableSession:join", sessionId);
        s.emit("tableSession:join", sessionId);
      }
      if (staff) {
        s.emit("staff:join");
      }
      if (tableId !== undefined) {
        s.emit("table:join", tableId);
      }
    };

    joinRooms();
    s.off("connect", joinRooms);
    s.on("connect", joinRooms);

    const handleReconnect = () => {
      onReconnect?.();
    };

    if (onReconnect) {
      s.io.off("reconnect", handleReconnect);
      s.io.on("reconnect", handleReconnect);
    }

    if (onQueueUpdated) {
      s.off("queue:updated", onQueueUpdated);
      s.on("queue:updated", onQueueUpdated);
    }
    if (onPlaybackUpdated) {
      s.off("playback:updated", onPlaybackUpdated);
      s.on("playback:updated", onPlaybackUpdated);
    }
    if (onTableUpdated) {
      s.off("table:updated", onTableUpdated);
      s.on("table:updated", onTableUpdated);
    }
    if (onBillUpdated) {
      s.off("bill:updated", onBillUpdated);
      s.on("bill:updated", onBillUpdated);
    }
    if (onOrderCreated) {
      s.off("order:created", onOrderCreated);
      s.on("order:created", onOrderCreated);
    }
    if (onOrderUpdated) {
      s.off("order:updated", onOrderUpdated);
      s.on("order:updated", onOrderUpdated);
    }
    if (onOrderRequestCreated)
      s.off("order-request:created", onOrderRequestCreated).on(
        "order-request:created",
        onOrderRequestCreated,
      );
    if (onOrderRequestUpdated)
      s.off("order-request:updated", onOrderRequestUpdated).on(
        "order-request:updated",
        onOrderRequestUpdated,
      );
    if (onTableSessionOpened)
      s.off("table-session:opened", onTableSessionOpened).on(
        "table-session:opened",
        onTableSessionOpened,
      );
    if (onTableSessionUpdated)
      s.off("table-session:updated", onTableSessionUpdated).on(
        "table-session:updated",
        onTableSessionUpdated,
      );
    if (onTableSessionClosed)
      s.off("table-session:closed", onTableSessionClosed).on(
        "table-session:closed",
        onTableSessionClosed,
      );
    if (onProductUpdated)
      s.off("product:updated", onProductUpdated).on(
        "product:updated",
        onProductUpdated,
      );

    return () => {
      s.off("connect", joinRooms);
      if (onReconnect) s.io.off("reconnect", handleReconnect);
      if (sessionId !== undefined) s.emit("tableSession:leave", sessionId);
      if (onQueueUpdated) s.off("queue:updated", onQueueUpdated);
      if (onPlaybackUpdated) s.off("playback:updated", onPlaybackUpdated);
      if (onTableUpdated) s.off("table:updated", onTableUpdated);
      if (onBillUpdated) s.off("bill:updated", onBillUpdated);
      if (onOrderCreated) s.off("order:created", onOrderCreated);
      if (onOrderUpdated) s.off("order:updated", onOrderUpdated);
      if (onOrderRequestCreated)
        s.off("order-request:created", onOrderRequestCreated);
      if (onOrderRequestUpdated)
        s.off("order-request:updated", onOrderRequestUpdated);
      if (onTableSessionOpened)
        s.off("table-session:opened", onTableSessionOpened);
      if (onTableSessionUpdated)
        s.off("table-session:updated", onTableSessionUpdated);
      if (onTableSessionClosed)
        s.off("table-session:closed", onTableSessionClosed);
      if (onProductUpdated) s.off("product:updated", onProductUpdated);
    };
  }, [
    sessionId,
    staff,
    tableId,
    onQueueUpdated,
    onPlaybackUpdated,
    onTableUpdated,
    onBillUpdated,
    onOrderCreated,
    onOrderUpdated,
    onOrderRequestCreated,
    onOrderRequestUpdated,
    onTableSessionOpened,
    onTableSessionUpdated,
    onTableSessionClosed,
    onProductUpdated,
    onReconnect,
  ]);

  const requestSong = useCallback((payload: SocketEvents["song:request"]) => {
    socketRef.current?.emit("song:request", payload);
  }, []);

  const isConnected = useCallback(
    () => socketRef.current?.connected ?? false,
    [],
  );

  return { requestSong, isConnected };
}
