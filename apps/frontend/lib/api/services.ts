import { adminApi, customerApi, publicApi, tableApi } from "./clients";
import type {
  BillView,
  Consumption,
  InventoryMovement,
  InventoryMovementType,
  Order,
  OrderRequest,
  OrderRequestItemInput,
  OrderRequestStatus,
  OrderStatus,
  PlaybackState,
  Product,
  QueueItem,
  Song,
  Table,
  TableSession,
  YouTubeSearchResult,
} from "@coffee-bar/shared";

// Which axios client backs each service is an editorial decision that
// encodes the security model. Do not paper over it with a dynamic resolver —
// that is exactly what Phase G8 consciously rejected.

// ─── Tables ───────────────────────────────────────────────────────────────────
// Admin-only surface (Phase G3). The customer QR never reaches these.
export const tablesApi = {
  getAll: (): Promise<Table[]> =>
    adminApi.get<Table[]>("/tables").then((r) => r.data),
  getById: (id: number): Promise<Table> =>
    adminApi.get<Table>(`/tables/${id}`).then((r) => r.data),
  getDetail: (id: number): Promise<Table> =>
    adminApi.get<Table>(`/tables/${id}/detail`).then((r) => r.data),
};

// ─── Table Sessions ───────────────────────────────────────────────────────────
// Discovery + open use the *table* token (QR). Close is admin. getById is
// admin (bill drawer).
export const tableSessionsApi = {
  /** Customer → server: returns session + `session_token` for next calls. */
  open: (tableId: number): Promise<TableSession & { session_token: string }> =>
    tableApi
      .post<TableSession & { session_token: string }>(
        "/table-sessions/open",
        { table_id: tableId },
      )
      .then((r) => r.data),
  /** Admin-only: manual close from the backoffice. */
  close: (sessionId: number): Promise<TableSession> =>
    adminApi
      .post<TableSession>(`/table-sessions/${sessionId}/close`)
      .then((r) => r.data),
  /** Admin side of the bill drawer. */
  getById: (sessionId: number): Promise<TableSession> =>
    adminApi
      .get<TableSession>(`/table-sessions/${sessionId}`)
      .then((r) => r.data),
  /**
   * Customer discovery. Returns null if no open session exists for this
   * table (backend 404 translated). Uses the table token from the QR.
   */
  getCurrentForTable: async (tableId: number): Promise<TableSession | null> => {
    try {
      const res = await tableApi.get<TableSession>(
        `/tables/${tableId}/session/current`,
      );
      return res.data;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) return null;
      throw err;
    }
  },
};

// ─── Order Requests ───────────────────────────────────────────────────────────
export const orderRequestsApi = {
  /** Admin reads the pending-requests column. */
  getAllForAdmin: (params?: {
    status?: OrderRequestStatus;
  }): Promise<OrderRequest[]> => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return adminApi
      .get<OrderRequest[]>(`/order-requests${suffix}`)
      .then((r) => r.data);
  },
  /** Customer reads its own session's requests. */
  getAllForSession: (sessionId: number): Promise<OrderRequest[]> =>
    customerApi
      .get<OrderRequest[]>(
        `/order-requests?table_session_id=${sessionId}`,
      )
      .then((r) => r.data),
  /** Customer creates a request within its active session. */
  create: (payload: {
    table_session_id: number;
    items: OrderRequestItemInput[];
  }): Promise<OrderRequest> =>
    customerApi
      .post<OrderRequest>("/order-requests", payload)
      .then((r) => r.data),
  /** Admin accepts. */
  accept: (id: number): Promise<OrderRequest> =>
    adminApi
      .post<OrderRequest>(`/order-requests/${id}/accept`)
      .then((r) => r.data),
  /** Admin rejects with optional reason. */
  reject: (id: number, reason?: string): Promise<OrderRequest> =>
    adminApi
      .post<OrderRequest>(`/order-requests/${id}/reject`, { reason })
      .then((r) => r.data),
  /** Customer cancels its own pending request. */
  cancel: (id: number): Promise<OrderRequest> =>
    customerApi
      .post<OrderRequest>(`/order-requests/${id}/cancel`)
      .then((r) => r.data),
};

// ─── Orders (operational transitions only) ───────────────────────────────────
export const ordersApi = {
  /** Admin view: unrestricted or filtered. */
  getAllForAdmin: (params?: { status?: OrderStatus }): Promise<Order[]> => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return adminApi.get<Order[]>(`/orders${suffix}`).then((r) => r.data);
  },
  /** Customer: its own session. */
  getAllForSession: (sessionId: number): Promise<Order[]> =>
    customerApi
      .get<Order[]>(`/orders?table_session_id=${sessionId}`)
      .then((r) => r.data),
  /** Admin transition. Never callable from the customer side. */
  updateStatus: (orderId: number, status: OrderStatus): Promise<Order> =>
    adminApi
      .patch<Order>(`/orders/${orderId}/status`, { status })
      .then((r) => r.data),
};

// ─── Bill / Consumptions ─────────────────────────────────────────────────────
// `created_by` is never sent by the client (Phase G6/G7). Backend stamps
// it from the authenticated admin.
export const billApi = {
  /** Both admin (any session) and customer (its own) can read. */
  getForAdmin: (sessionId: number): Promise<BillView> =>
    adminApi.get<BillView>(`/bill/${sessionId}`).then((r) => r.data),
  getForSession: (sessionId: number): Promise<BillView> =>
    customerApi.get<BillView>(`/bill/${sessionId}`).then((r) => r.data),
  createAdjustment: (
    sessionId: number,
    payload: {
      type: "adjustment" | "discount";
      amount: number;
      reason: string;
      notes?: string;
    },
  ): Promise<Consumption> =>
    adminApi
      .post<Consumption>(`/bill/${sessionId}/adjustments`, payload)
      .then((r) => r.data),
  refundConsumption: (
    consumptionId: number,
    payload: { reason: string; notes?: string },
  ): Promise<Consumption> =>
    adminApi
      .post<Consumption>(`/consumptions/${consumptionId}/refund`, payload)
      .then((r) => r.data),
};

// ─── Products ─────────────────────────────────────────────────────────────────
// Public read: the customer cart and the admin catalog both read it without
// auth. Returns only active products.
export const productsApi = {
  getAll: (): Promise<Product[]> =>
    publicApi.get<Product[]>("/products").then((r) => r.data),
};

// ─── Admin product CRUD (Phase H2) ────────────────────────────────────────────
// All endpoints require an admin JWT. Stock changes do NOT live here — they
// belong to inventoryMovementsApi (H3) so every delta has an audit row.
export const adminProductsApi = {
  getAll: (params?: {
    category?: string;
    include_inactive?: boolean;
    low_stock?: boolean;
  }): Promise<Product[]> => {
    const q = new URLSearchParams();
    if (params?.category) q.set("category", params.category);
    if (params?.include_inactive === false) q.set("include_inactive", "false");
    if (params?.low_stock) q.set("low_stock", "true");
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi.get<Product[]>(`/admin/products${suffix}`).then((r) => r.data);
  },
  getById: (id: number): Promise<Product> =>
    adminApi.get<Product>(`/admin/products/${id}`).then((r) => r.data),
  create: (payload: {
    name: string;
    description?: string;
    price: number;
    stock?: number;
    low_stock_threshold?: number;
    category: string;
    is_active?: boolean;
  }): Promise<Product> =>
    adminApi.post<Product>("/admin/products", payload).then((r) => r.data),
  update: (
    id: number,
    payload: {
      name?: string;
      description?: string;
      price?: number;
      low_stock_threshold?: number;
      category?: string;
    },
  ): Promise<Product> =>
    adminApi.patch<Product>(`/admin/products/${id}`, payload).then((r) => r.data),
  activate: (id: number): Promise<Product> =>
    adminApi
      .patch<Product>(`/admin/products/${id}/activate`)
      .then((r) => r.data),
  deactivate: (id: number): Promise<Product> =>
    adminApi
      .patch<Product>(`/admin/products/${id}/deactivate`)
      .then((r) => r.data),
};

// ─── Sales insights (Phase H5) ────────────────────────────────────────────────
export type ProductSalesSummary = {
  product_id: number;
  name: string;
  category: string;
  units_sold: number;
  revenue: number;
};

export type SalesInsightsResponse = {
  range: { from: string; to: string; days: number };
  summary: {
    total_units: number;
    total_revenue: number;
    distinct_products_sold: number;
  };
  top_selling: ProductSalesSummary[];
  revenue_by_product: ProductSalesSummary[];
  low_rotation: {
    product_id: number;
    name: string;
    category: string;
    stock: number;
  }[];
  low_stock_high_demand: (ProductSalesSummary & {
    stock: number;
    low_stock_threshold: number;
  })[];
};

export const salesInsightsApi = {
  get: (params?: {
    day?: string;
    days?: number;
    top_limit?: number;
  }): Promise<SalesInsightsResponse> => {
    const q = new URLSearchParams();
    if (params?.day) q.set("day", params.day);
    if (params?.days) q.set("days", String(params.days));
    if (params?.top_limit) q.set("top_limit", String(params.top_limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi
      .get<SalesInsightsResponse>(`/admin/sales/insights${suffix}`)
      .then((r) => r.data);
  },
};

// ─── Inventory movements (Phase H3) ───────────────────────────────────────────
// All admin. The `quantity` field is a SIGNED delta; UI labels describe it
// per type ("Unidades a desechar: 3" → quantity: -3) but the wire value is
// always the real delta.
export const inventoryMovementsApi = {
  record: (
    productId: number,
    payload: {
      type: InventoryMovementType;
      quantity: number;
      reason: string;
      notes?: string;
    },
  ): Promise<InventoryMovement> =>
    adminApi
      .post<InventoryMovement>(
        `/admin/products/${productId}/stock-movements`,
        payload,
      )
      .then((r) => r.data),
  listForProduct: (
    productId: number,
    params?: { limit?: number },
  ): Promise<InventoryMovement[]> => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi
      .get<InventoryMovement[]>(
        `/admin/products/${productId}/stock-movements${suffix}`,
      )
      .then((r) => r.data);
  },
  listGlobal: (params?: {
    type?: InventoryMovementType;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<InventoryMovement[]> => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.limit) q.set("limit", String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi
      .get<InventoryMovement[]>(`/admin/inventory-movements${suffix}`)
      .then((r) => r.data);
  },
};

// ─── Songs ────────────────────────────────────────────────────────────────────
export const songsApi = {
  getAll: (): Promise<Song[]> =>
    publicApi.get<Song[]>("/songs").then((r) => r.data),
};

// ─── Queue ────────────────────────────────────────────────────────────────────
// Reads are public (the TV player has no login). Customer writes use
// `customerApi` (session token). Admin writes use `adminApi`.
export const queueApi = {
  getGlobal: (): Promise<QueueItem[]> =>
    publicApi.get<QueueItem[]>("/queue/global").then((r) => r.data),
  getByTable: (tableId: number): Promise<QueueItem[]> =>
    customerApi
      .get<QueueItem[]>(`/queue?table_id=${tableId}`)
      .then((r) => r.data),
  getByTableWithHistory: (tableId: number): Promise<QueueItem[]> =>
    customerApi
      .get<QueueItem[]>(`/queue?table_id=${tableId}&include_history=true`)
      .then((r) => r.data),
  getCurrent: (): Promise<QueueItem | null> =>
    publicApi.get<QueueItem | null>("/queue/current").then((r) => r.data),
  addSong: (payload: {
    youtube_id: string;
    title: string;
    duration: number;
    table_id: number;
  }): Promise<QueueItem> =>
    customerApi.post<QueueItem>("/queue", payload).then((r) => r.data),
  playNext: (): Promise<QueueItem | null> =>
    adminApi.post<QueueItem | null>("/queue/play-next").then((r) => r.data),
  finishCurrent: (): Promise<QueueItem | null> =>
    adminApi.post<QueueItem | null>("/queue/finish-current").then((r) => r.data),
  skip: (itemId: number): Promise<QueueItem> =>
    adminApi.patch<QueueItem>(`/queue/${itemId}/skip`).then((r) => r.data),
  advanceToNext: (): Promise<QueueItem | null> =>
    adminApi.post<QueueItem | null>("/queue/next").then((r) => r.data),
  skipAndAdvance: (): Promise<QueueItem | null> =>
    adminApi
      .post<QueueItem | null>("/queue/skip-and-advance")
      .then((r) => r.data),
  adminCreate: (payload: {
    youtube_id: string;
    title: string;
    duration: number;
    position?: number;
  }): Promise<QueueItem> =>
    adminApi.post<QueueItem>("/queue/admin", payload).then((r) => r.data),
  adminPlayNow: (payload: {
    youtube_id: string;
    title: string;
    duration: number;
  }): Promise<QueueItem> =>
    adminApi
      .post<QueueItem>("/queue/admin/play-now", payload)
      .then((r) => r.data),
  getStats: (): Promise<{
    songs_played_today: number;
    songs_skipped_today: number;
    songs_pending: number;
    total_songs_today: number;
    avg_wait_seconds: number | null;
    tables_participating: number;
    top_table: { table_id: number; count: number } | null;
  }> => adminApi.get("/queue/stats").then((r) => r.data),
};

export const playbackApi = {
  getCurrent: (): Promise<PlaybackState> =>
    publicApi.get<PlaybackState>("/playback/current").then((r) => r.data),
  /** The TV player hits these directly; they are public today. */
  setPlaying: (): Promise<PlaybackState> =>
    publicApi.patch<PlaybackState>("/playback/playing").then((r) => r.data),
  updateProgress: (positionSeconds: number): Promise<PlaybackState> =>
    publicApi
      .patch<PlaybackState>("/playback/progress", {
        position_seconds: positionSeconds,
      })
      .then((r) => r.data),
};

// ─── Music ────────────────────────────────────────────────────────────────────
export const musicApi = {
  search: (query: string): Promise<YouTubeSearchResult[]> =>
    publicApi
      .get<YouTubeSearchResult[]>(
        `/music/search?q=${encodeURIComponent(query)}`,
      )
      .then((r) => r.data),
};
