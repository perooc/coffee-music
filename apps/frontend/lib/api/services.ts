import api from "./client";
import type {
  Table,
  QueueItem,
  Order,
  Product,
  Song,
  YouTubeSearchResult,
} from "@/types";

// ─── Tables ───────────────────────────────────────────────────────────────────
export const tablesApi = {
  getAll: (): Promise<Table[]> =>
    api.get<Table[]>("/tables").then((r) => r.data),
  getById: (id: number): Promise<Table> =>
    api.get<Table>(`/tables/${id}`).then((r) => r.data),
};

// ─── Songs ────────────────────────────────────────────────────────────────────
export const songsApi = {
  getAll: (): Promise<Song[]> => api.get<Song[]>("/songs").then((r) => r.data),
};

// ─── Queue ────────────────────────────────────────────────────────────────────
export const queueApi = {
  getGlobal: (): Promise<QueueItem[]> =>
    api.get<QueueItem[]>("/queue/global").then((r) => r.data),
  getByTable: (tableId: number): Promise<QueueItem[]> =>
    api.get<QueueItem[]>(`/queue?table_id=${tableId}`).then((r) => r.data),
  addSong: (payload: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number;
  }): Promise<QueueItem> =>
    api.post<QueueItem>("/queue", payload).then((r) => r.data),
  skip: (itemId: number): Promise<QueueItem> =>
    api.patch<QueueItem>(`/queue/${itemId}/skip`).then((r) => r.data),
};

// ─── Orders ───────────────────────────────────────────────────────────────────
export const ordersApi = {
  getAll: (): Promise<Order[]> =>
    api.get<Order[]>("/orders").then((r) => r.data),
  getByTable: (tableId: number): Promise<Order[]> =>
    api.get<Order[]>(`/orders?table_id=${tableId}`).then((r) => r.data),
  create: (payload: {
    table_id: number;
    items: { product_id: number; quantity: number }[];
  }): Promise<Order> => api.post<Order>("/orders", payload).then((r) => r.data),
  updateStatus: (orderId: number, status: Order["status"]): Promise<Order> =>
    api
      .patch<Order>(`/orders/${orderId}/status`, { status })
      .then((r) => r.data),
};

// ─── Products ─────────────────────────────────────────────────────────────────
export const productsApi = {
  getAll: (): Promise<Product[]> =>
    api.get<Product[]>("/products").then((r) => r.data),
};

// ─── Music ────────────────────────────────────────────────────────────────────
export const musicApi = {
  search: (query: string): Promise<YouTubeSearchResult[]> =>
    api
      .get<
        YouTubeSearchResult[]
      >(`/music/search?q=${encodeURIComponent(query)}`)
      .then((r) => r.data),
};
