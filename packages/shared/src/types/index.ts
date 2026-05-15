export type TableStatus = "available" | "occupied" | "closing";

export type TableSessionStatus = "open" | "ordering" | "closing" | "closed";

export type OrderRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

export type OrderStatus =
  | "accepted"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export type ConsumptionType =
  | "product"
  | "adjustment"
  | "discount"
  | "refund"
  | "partial_payment";

export type TableKind = "TABLE" | "BAR";

export type QueueStatus = "pending" | "playing" | "played" | "skipped";

export type PlaybackStatus = "idle" | "buffering" | "playing" | "paused";

export interface TableCountSummary {
  queue_items: number;
  songs: number;
}

export interface Table {
  id: number;
  number: number;
  qr_code: string;
  kind: TableKind;
  status: TableStatus;
  current_session_id: number | null;
  total_consumption: number;
  active_order_count: number;
  pending_request_count: number;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
  songs?: Song[];
  queue_items?: QueueItem[];
  orders?: Order[];
  _count?: TableCountSummary;
  /**
   * Slim view of the table's current session. Lets the admin dashboard
   * render payment badges without round-tripping per row. Null when the
   * table has no open session.
   *
   * `song_credits` is the per-session ledger that decides whether the
   * table can add a 6th+ song to the queue. See SongCredits in shared
   * constants for the math.
   */
  current_session?: {
    id: number;
    status: TableSessionStatus;
    payment_requested_at: string | null;
    paid_at: string | null;
    opened_at: string;
    custom_name?: string | null;
    opened_by?: string;
    song_credits: {
      earned: number;
      spent: number;
      available: number;
    };
  } | null;
}

export interface TableSession {
  id: number;
  table_id: number;
  status: TableSessionStatus;
  total_consumption: number;
  last_consumption_at: string | null;
  opened_at: string;
  closed_at: string | null;
  /**
   * Set when the customer presses "Pedir cuenta". While not null, the
   * session blocks new OrderRequest creation. Cleared by either the
   * customer (cancel) or by the admin closing the session.
   */
  payment_requested_at: string | null;
  /**
   * Set when the admin marks the bill as paid. The session can still stay
   * open — the customer can keep consuming, but new orders remain blocked
   * until the admin closes the session.
   */
  paid_at: string | null;
  /**
   * Free-form label set when staff opens the session from the admin
   * dashboard (typically the customer's first name). Null for sessions
   * opened by a customer scanning the QR.
   */
  custom_name: string | null;
  /**
   * Origin of the session. "customer" = QR scan + Iniciar mesa.
   * "staff" = admin opens it on behalf of the customer (bar account or
   * a regular table where the customer didn't scan).
   */
  opened_by: string;
  metadata: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface Song {
  id: number;
  youtube_id: string;
  title: string;
  duration: number;
  requested_by_table: number | null;
  created_at: string;
}

export interface YouTubeSearchResult {
  youtubeId: string;
  title: string;
  duration: number;
  thumbnail?: string;
}

export interface QueueItem {
  id: number;
  song_id: number;
  table_id: number | null;
  priority_score: number;
  status: QueueStatus;
  position: number;
  queued_at: string;
  created_at: string;
  updated_at: string;
  started_playing_at: string | null;
  finished_at: string | null;
  skipped_at: string | null;
  song?: Song;
  table?: Table;
}

export interface PlaybackState {
  status: PlaybackStatus;
  queue_item_id: number | null;
  song: Song | null;
  table_id: number | null;
  started_at: string | null;
  updated_at: string | null;
  position_seconds: number | null;
}

export interface Product {
  id: number;
  // Identificador estable e independiente del nombre. Útil para
  // integraciones, imports y seeds. Siempre presente en respuestas.
  sku: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  category: string;
  created_at: string;
  updated_at: string;
  // Computed by the API; clients should never recompute themselves.
  is_low_stock?: boolean;
  is_out_of_stock?: boolean;
  // Computed by the API for productos compuestos. "available" si las
  // cantidades de componentes alcanzan al menos para 1 unidad; en
  // caso contrario "out_of_stock". Para productos simples puede
  // omitirse — el frontend cae a `stock > 0`.
  availability?: "available" | "out_of_stock";
}

export type InventoryMovementType =
  | "restock"
  | "adjustment"
  | "waste"
  | "correction";

export interface InventoryMovement {
  id: number;
  product_id: number;
  type: InventoryMovementType;
  /**
   * Signed delta applied to Product.stock at recording time.
   *   restock     > 0
   *   waste       < 0
   *   adjustment  != 0
   *   correction  != 0
   */
  quantity: number;
  reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  created_at: string;
  unit_price: number;
  product?: Product;
}

export interface OrderRequestItemInput {
  product_id: number;
  quantity: number;
}

export interface OrderRequest {
  id: number;
  table_session_id: number;
  status: OrderRequestStatus;
  items: OrderRequestItemInput[];
  rejection_reason: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  order?: Order | null;
  table_session?: {
    id: number;
    table_id: number;
    status: TableSessionStatus;
  };
}

export interface Order {
  id: number;
  table_session_id: number;
  order_request_id: number;
  status: OrderStatus;
  accepted_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[];
  table_session?: {
    id: number;
    table_id: number;
    status: TableSessionStatus;
  };
}

export interface Consumption {
  id: number;
  table_session_id: number;
  order_id: number | null;
  product_id: number | null;
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  type: ConsumptionType;
  reversed_at: string | null;
  reverses_id: number | null;
  reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  order?: { id: number; status: OrderStatus } | null;
  reverses?: {
    id: number;
    description: string;
    amount: number;
    type: ConsumptionType;
  } | null;
}

export interface BillSummary {
  subtotal: number;
  discounts_total: number;
  adjustments_total: number;
  // Sum of `partial_payment` entries — already negative.
  partial_payments_total: number;
  total: number;
  item_count: number;
}

export interface BillView {
  session_id: number;
  table_id: number;
  status: TableSessionStatus;
  opened_at: string;
  closed_at: string | null;
  last_consumption_at: string | null;
  summary: BillSummary;
  items: Consumption[];
}
