// ─── Enums ────────────────────────────────────────────────────────────────────
export type TableStatus = "available" | "active" | "occupied" | "inactive";
export type QueueStatus = "pending" | "playing" | "played" | "skipped";
export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

// ─── Tables ───────────────────────────────────────────────────────────────────
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

// ─── Music ────────────────────────────────────────────────────────────────────
export interface Song {
  id: number;
  youtube_id: string;
  title: string;
  duration: number;
  requested_by_table: number;
  created_at: string;
}

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

// ─── Orders ───────────────────────────────────────────────────────────────────
export interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  category: string;
}

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

// ─── YouTube search ───────────────────────────────────────────────────────────
export interface YouTubeSearchResult {
  youtubeId: string;
  title: string;
  duration: string;
}

// ─── Socket events ────────────────────────────────────────────────────────────
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
