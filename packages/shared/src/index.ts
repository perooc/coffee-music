// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum songs a single table can have pending/playing at once */
export const MAX_SONGS_PER_TABLE = 2;

/** Maximum song duration in seconds (10 minutes) */
export const MAX_SONG_DURATION_SECONDS = 600;

/** Reference amount for scoreboard progress bar (COP) */
export const SCOREBOARD_MAX_CONSUMPTION = 120_000;

/** Priority score factor: total_consumption / this value */
export const PRIORITY_SCORE_DIVISOR = 1000;

// ─── Tables ───────────────────────────────────────────────────────────────────
export type TableStatus = "available" | "active" | "occupied" | "inactive";

export interface Table {
  id: number;
  qr_code: string;
  status: TableStatus;
  total_consumption: number;
  created_at: string;
  updated_at?: string;
  _count?: {
    orders: number;
    queue_items: number;
    songs: number;
  };
}

// ─── Songs ────────────────────────────────────────────────────────────────────
export interface Song {
  id: number;
  youtube_id: string;
  title: string;
  duration: number;
  requested_by_table: number;
  created_at: string;
}

export interface YouTubeSearchResult {
  youtubeId: string;
  title: string;
  duration: number;
  thumbnail?: string;
}

// ─── Queue ────────────────────────────────────────────────────────────────────
export type QueueStatus = "pending" | "playing" | "played" | "skipped";

export interface QueueItem {
  id: number;
  song_id: number;
  table_id: number;
  priority_score: number;
  status: QueueStatus;
  position: number;
  song?: Song;
  table?: Table;
}

// ─── Products ─────────────────────────────────────────────────────────────────
export interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  category: string;
}

// ─── Orders ───────────────────────────────────────────────────────────────────
export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price?: number;
  product?: Product;
}

export interface Order {
  id: number;
  table_id: number;
  status: OrderStatus;
  total: number;
  created_at: string;
  updated_at?: string;
  order_items?: OrderItem[];
}

// ─── Socket ───────────────────────────────────────────────────────────────────
export type SocketEvents = {
  "queue:updated": QueueItem[];
  "table:updated": Table;
  "order:updated": Order;
  "song:request": {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number;
  };
  "table:join": number;
};
