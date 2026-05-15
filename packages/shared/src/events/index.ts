import type {
  BillView,
  Order,
  OrderRequest,
  PlaybackState,
  Product,
  QueueItem,
  Table,
  TableSession,
} from "../types";

export interface SongRequestPayload {
  youtube_id: string;
  title: string;
  duration: number;
  table_id: number;
}

/**
 * Socket events and their payload shapes. Channels:
 *   - session : emitted into `tableSession:{id}` room
 *   - staff   : broadcast today (pre-auth), future staff-only room
 *   - global  : every connected client
 * Client rooms are joined by emitting `tableSession:join` with sessionId,
 * or `staff:join` with no payload.
 */
export type SocketEvents = {
  // session + staff
  "bill:updated": BillView;
  "order:created": Order;
  "order:updated": Order;
  "order-request:created": OrderRequest;
  "order-request:updated": OrderRequest;
  "table-session:opened": TableSession;
  "table-session:updated": Partial<TableSession> & { id: number };
  "table-session:closed": TableSession;

  // staff + global
  "table:updated": Partial<Table> & { id: number };

  // global
  "queue:updated": QueueItem[];
  "playback:updated": PlaybackState;
  // Productos cuyo stock, precio, estado o receta cambió. Se manda como
  // batch: el cliente reemplaza/inserta cada uno por id. Cubre tanto el
  // panel admin de productos como las vistas /mesa/*.
  "product:updated": { products: Product[] };

  // client → server
  "song:request": SongRequestPayload;
  "tableSession:join": number;
  "tableSession:leave": number;
  "staff:join": void;
  "table:join": number; // legacy, kept for back-compat
};
