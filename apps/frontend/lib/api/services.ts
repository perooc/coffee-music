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
  /** Create a virtual BAR account. Name is shown to staff in the grid. */
  createBar: (name: string): Promise<Table> =>
    adminApi.post<Table>("/tables/bars", { name }).then((r) => r.data),
  /** Delete a virtual BAR. Refused while it has an open session. */
  deleteBar: (id: number): Promise<{ ok: true }> =>
    adminApi.delete<{ ok: true }>(`/tables/bars/${id}`).then((r) => r.data),
  /**
   * Atomic "open a walk-in account": create the virtual BAR row and
   * open its session in a single round-trip. Used by the "+ Nueva
   * cuenta" button in the admin grid.
   */
  openWalkInAccount: (
    name: string,
  ): Promise<{ table: Table; session: TableSession }> =>
    adminApi
      .post<{ table: Table; session: TableSession }>(
        "/tables/bars/walkin",
        { name },
      )
      .then((r) => r.data),
};

// ─── Bar access code (gate before opening a session) ────────────────────────
// 4-digit numeric code that rotates daily. Customers type it on the mesa
// page before they can open a session; admins see it (and rotate it) in
// the dashboard widget. The `id` is exposed alongside the code so the
// customer device can tell when it has been rotated since the device
// last validated it.
type AccessCodePayload = {
  id: number;
  code: string;
  expires_at: string;
};

export const accessCodeApi = {
  validate: (code: string): Promise<{ ok: true }> =>
    publicApi
      .post<{ ok: true }>("/access-code/validate", { code })
      .then((r) => r.data),
  getCurrent: (): Promise<AccessCodePayload> =>
    adminApi.get("/access-code/current").then((r) => r.data),
  /**
   * Public read for the player TV. No admin token needed — the code is
   * meant to be visible on a public screen anyway.
   */
  getForDisplay: (): Promise<AccessCodePayload> =>
    publicApi.get("/access-code/display").then((r) => r.data),
  rotate: (): Promise<AccessCodePayload> =>
    adminApi.post("/access-code/rotate").then((r) => r.data),
};

// ─── Auth (password reset) ──────────────────────────────────────────────────
export const authApi = {
  forgotPassword: (email: string): Promise<{ ok: true }> =>
    publicApi
      .post<{ ok: true }>("/auth/forgot-password", { email })
      .then((r) => r.data),
  resetPassword: (
    email: string,
    token: string,
    password: string,
  ): Promise<{ ok: true }> =>
    publicApi
      .post<{ ok: true }>("/auth/reset-password", { email, token, password })
      .then((r) => r.data),
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
  /**
   * Admin opens (or joins) a session on behalf of the customer. Used
   * when staff seats a guest who didn't scan, or when opening a virtual
   * BAR account. `custom_name` becomes the label in the admin grid.
   */
  openByAdmin: (
    tableId: number,
    customName?: string,
  ): Promise<TableSession> =>
    adminApi
      .post<TableSession>("/admin/table-sessions/open", {
        table_id: tableId,
        custom_name: customName,
      })
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

  // ─── Payment flow ───────────────────────────────────────────────────────
  /** Customer asks for the bill. Blocked while there are in-flight orders. */
  requestPayment: (sessionId: number): Promise<TableSession> =>
    customerApi
      .post<TableSession>(`/table-sessions/${sessionId}/request-payment`)
      .then((r) => r.data),
  /** Customer cancels their own pending payment request. */
  cancelPaymentRequest: (sessionId: number): Promise<TableSession> =>
    customerApi
      .post<TableSession>(
        `/table-sessions/${sessionId}/cancel-payment-request`,
      )
      .then((r) => r.data),
  /** Admin records the payment AND closes the session in one step. */
  markPaid: (sessionId: number): Promise<TableSession> =>
    adminApi
      .post<TableSession>(`/table-sessions/${sessionId}/mark-paid`)
      .then((r) => r.data),
  /**
   * Admin cierra la sesión SIN cobro, con razón obligatoria. Casos:
   *   - customer_left: cliente se fue sin pagar.
   *   - admin_error: sesión abierta por error.
   *   - comp: cortesía de la casa.
   *   - other: requiere `other_detail` con texto libre.
   *
   * No es reversible: si fue error registrar el void, hay que crear un
   * movimiento manual aparte. Esto protege la trazabilidad.
   */
  voidSession: (
    sessionId: number,
    body: {
      reason: "customer_left" | "admin_error" | "comp" | "other";
      other_detail?: string;
    },
  ): Promise<TableSession> =>
    adminApi
      .post<TableSession>(`/table-sessions/${sessionId}/void`, body)
      .then((r) => r.data),
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
  /**
   * Admin shortcut: create + immediately accept. Used when staff adds
   * products to a session from the bill drawer; the resulting Order
   * goes straight to "accepted" without sitting in the pending column.
   */
  quickAdd: (payload: {
    table_session_id: number;
    items: OrderRequestItemInput[];
  }): Promise<OrderRequest> =>
    adminApi
      .post<OrderRequest>("/order-requests/admin/quick-add", payload)
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
  /**
   * Customer edits the items of its own pending request. Backend rejects
   * with ORDER_REQUEST_NOT_PENDING (409) if admin accepted in the meantime.
   */
  update: (
    id: number,
    payload: { items: OrderRequestItemInput[] },
  ): Promise<OrderRequest> =>
    customerApi
      .patch<OrderRequest>(`/order-requests/${id}`, payload)
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
    payload: {
      reason: string;
      notes?: string;
      // Default backend = true. Pasar false cuando el producto ya
      // se consumió/desechó físicamente (ej. botella rota).
      restore_stock?: boolean;
    },
  ): Promise<Consumption> =>
    adminApi
      .post<Consumption>(`/consumptions/${consumptionId}/refund`, payload)
      .then((r) => r.data),
  /**
   * Admin records cash collected mid-session. Lands as a Consumption
   * with type=partial_payment and a negative amount, so the bill total
   * automatically becomes "remaining to pay".
   */
  recordPartialPayment: (
    sessionId: number,
    amount: number,
  ): Promise<Consumption> =>
    adminApi
      .post<Consumption>(`/bill/${sessionId}/partial-payment`, { amount })
      .then((r) => r.data),
};

// ─── Products ─────────────────────────────────────────────────────────────────
// Public read: the customer cart and the admin catalog both read it without
// auth. Returns only active products.
export const productsApi = {
  getAll: (): Promise<Product[]> =>
    publicApi.get<Product[]>("/products").then((r) => r.data),
  /**
   * Recetas en bulk de todos los productos compuestos. Una sola
   * llamada al cargar el catálogo; el cart busca por product_id.
   */
  getRecipesBulk: (): Promise<Record<number, ProductRecipeSlotView[]>> =>
    publicApi
      .get<Record<number, ProductRecipeSlotView[]>>("/products/recipes")
      .then((r) => r.data),
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
    // Backend default: NO incluir inactivos. Sólo agregamos el flag
    // cuando explícitamente queremos verlos (tab "Inactivos").
    if (params?.include_inactive === true) q.set("include_inactive", "true");
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

  // ─── Recipes ─────────────────────────────────────────────────────────────
  /** Devuelve la receta del producto (slots + opciones serializados). */
  getRecipe: (id: number): Promise<ProductRecipeSlotView[]> =>
    adminApi
      .get<ProductRecipeSlotView[]>(`/admin/products/${id}/recipe`)
      .then((r) => r.data),

  /** Reemplaza la receta entera. Vacío = producto pasa a simple. */
  putRecipe: (
    id: number,
    slots: ProductRecipeSlotPayload[],
  ): Promise<ProductRecipeSlotView[]> =>
    adminApi
      .put<ProductRecipeSlotView[]>(`/admin/products/${id}/recipe`, { slots })
      .then((r) => r.data),
};

// ─── Recipe types ───────────────────────────────────────────────────────────
export interface ProductRecipeOptionPayload {
  component_id: number;
  default_quantity: number;
  position?: number;
}

export interface ProductRecipeSlotPayload {
  label: string;
  quantity: number;
  position?: number;
  options: ProductRecipeOptionPayload[];
}

export interface ProductRecipeOptionView {
  id: number;
  component_id: number;
  default_quantity: number;
  position: number;
  component: {
    id: number;
    sku: string;
    name: string;
    category: string;
    stock: number;
    is_active: boolean;
  };
}

export interface ProductRecipeSlotView {
  id: number;
  label: string;
  quantity: number;
  position: number;
  options: ProductRecipeOptionView[];
}

// ─── Sales insights (Phase H5 + dashboard ejecutivo) ─────────────────────────
export type ProductSalesSummary = {
  product_id: number;
  name: string;
  category: string;
  units_sold: number;
  revenue: number;
};

export type DailySalesPoint = {
  /** YYYY-MM-DD, hora local del servidor. */
  date: string;
  /** 0=Domingo … 6=Sábado (JS getDay). */
  weekday: number;
  units: number;
  revenue: number;
  /** Tickets (sesiones únicas con ventas) que cayeron en ese día. */
  tickets: number;
};

export type HourlySalesPoint = {
  /** 0..23, hora local del servidor. */
  hour: number;
  units: number;
  revenue: number;
};

export type WeekdaySalesPoint = {
  weekday: number;
  avg_units: number;
  avg_revenue: number;
  /** Cantidad de ese weekday dentro del rango (denominador del avg). */
  sample_count: number;
};

export type CategorySalesPoint = {
  category: string;
  units: number;
  revenue: number;
};

export type SalesPeriodTotals = {
  total_units: number;
  total_revenue: number;
  tickets_count: number;
  avg_ticket: number;
};

export type SalesInsightsResponse = {
  range: { from: string; to: string; days: number };
  summary: {
    total_units: number;
    total_revenue: number;
    distinct_products_sold: number;
    tickets_count: number;
    avg_ticket: number;
  };
  /** Período inmediatamente anterior de igual tamaño. Útil para deltas. */
  previous_period: SalesPeriodTotals;
  daily_breakdown: DailySalesPoint[];
  hourly_breakdown: HourlySalesPoint[];
  weekday_breakdown: WeekdaySalesPoint[];
  revenue_by_category: CategorySalesPoint[];
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

export type ProductSalesHistoryResponse = {
  product: { id: number; name: string; category: string };
  range: { from: string; to: string; days: number };
  daily_sales: {
    date: string;
    weekday: number;
    units: number;
    revenue: number;
  }[];
  weekday_avg: {
    weekday: number;
    avg_units: number;
    avg_revenue: number;
    sample_count: number;
  }[];
  totals: { units: number; revenue: number };
};

// ─── Tipos del tab "Detalle" (cuentas cerradas con detalle) ─────────────
export type ClosedSessionLineUnitApi = {
  unit_index: number;
  components: { name: string; quantity: number }[];
};

export type ClosedSessionLineApi = {
  consumption_id: number;
  type:
    | "product"
    | "adjustment"
    | "discount"
    | "refund"
    | "partial_payment";
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  created_at: string;
  /** Composición por unidad para productos compuestos. Vacío para simples. */
  units: ClosedSessionLineUnitApi[];
};

export type ClosedSessionApi = {
  session_id: number;
  table_id: number;
  table_number: number | null;
  table_kind: "TABLE" | "BAR";
  custom_name: string | null;
  opened_at: string;
  closed_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  void_other_detail: string | null;
  outcome: "paid" | "void";
  subtotal: number;
  adjustments_total: number;
  partial_payments_total: number;
  /** Saldo del ledger al cierre (NO es lo cobrado si hubo anticipos). */
  total: number;
  /** Lo efectivamente cobrado por la cuenta. = subtotal + adjustments_total. */
  collected: number;
  lines: ClosedSessionLineApi[];
};

export type ClosedSessionsResponse = {
  range: { from: string; to: string; days: number };
  total: number;
  paid_count: number;
  void_count: number;
  paid_revenue: number;
  void_lost_revenue: number;
  sessions: ClosedSessionApi[];
};

// ─── Tipos del tab "Productos" (catálogo completo con métricas) ─────────
export type ProductMetricsRowApi = {
  product_id: number;
  name: string;
  category: string;
  is_active: boolean;
  stock: number;
  units_sold: number;
  revenue: number;
  avg_ticket: number;
  revenue_pct: number;
};

export type ProductMetricsResponse = {
  range: { from: string; to: string; days: number };
  total_revenue: number;
  total_units: number;
  total: number;
  page: number;
  page_size: number;
  rows: ProductMetricsRowApi[];
};

export const salesInsightsApi = {
  get: (params?: {
    day?: string;
    days?: number;
    /** YYYY-MM-DD inclusivo. Requiere también `to`. */
    from?: string;
    /** YYYY-MM-DD inclusivo. Requiere también `from`. */
    to?: string;
    top_limit?: number;
  }): Promise<SalesInsightsResponse> => {
    const q = new URLSearchParams();
    if (params?.day) q.set("day", params.day);
    if (params?.days) q.set("days", String(params.days));
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.top_limit) q.set("top_limit", String(params.top_limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi
      .get<SalesInsightsResponse>(`/admin/sales/insights${suffix}`)
      .then((r) => r.data);
  },

  /**
   * Histórico día-por-día de un producto. Default 60 días.
   * Útil para identificar patrones de fin de semana / días pico.
   */
  getProductHistory: (
    productId: number,
    params?: { days?: number; from?: string; to?: string },
  ): Promise<ProductSalesHistoryResponse> => {
    const q = new URLSearchParams();
    if (params?.days) q.set("days", String(params.days));
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi
      .get<ProductSalesHistoryResponse>(
        `/admin/sales/products/${productId}/history${suffix}`,
      )
      .then((r) => r.data);
  },

  /** Cuentas cerradas (pagadas + anuladas) en el rango. */
  getClosedSessions: (params?: {
    day?: string;
    days?: number;
    from?: string;
    to?: string;
  }): Promise<ClosedSessionsResponse> => {
    const q = new URLSearchParams();
    if (params?.day) q.set("day", params.day);
    if (params?.days) q.set("days", String(params.days));
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi
      .get<ClosedSessionsResponse>(`/admin/sales/sessions${suffix}`)
      .then((r) => r.data);
  },

  /** Catálogo completo con métricas; soporta buscador, orden y paginado. */
  getAllProducts: (params?: {
    day?: string;
    days?: number;
    from?: string;
    to?: string;
    search?: string;
    sort?: "revenue" | "units" | "name" | "category";
    direction?: "asc" | "desc";
    page?: number;
    page_size?: number;
    include_inactive?: boolean;
  }): Promise<ProductMetricsResponse> => {
    const q = new URLSearchParams();
    if (params?.day) q.set("day", params.day);
    if (params?.days) q.set("days", String(params.days));
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.search) q.set("search", params.search);
    if (params?.sort) q.set("sort", params.sort);
    if (params?.direction) q.set("direction", params.direction);
    if (params?.page) q.set("page", String(params.page));
    if (params?.page_size) q.set("page_size", String(params.page_size));
    if (params?.include_inactive) q.set("include_inactive", "true");
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return adminApi
      .get<ProductMetricsResponse>(`/admin/sales/products${suffix}`)
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

// ─── House Playlist (admin) ──────────────────────────────────────────────────
export interface HousePlaylistCategorySlim {
  id: number;
  name: string;
}

export interface HousePlaylistItem {
  id: number;
  youtube_id: string;
  title: string;
  artist: string | null;
  duration: number;
  is_active: boolean;
  sort_order: number;
  last_played_at: string | null;
  created_at: string;
  updated_at: string;
  categories?: HousePlaylistCategorySlim[];
}

export interface HousePlaylistCategory {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  _count?: { items: number };
}

export type HousePlaylistValidation =
  | {
      valid: true;
      youtube_id: string;
      title: string;
      artist: string | null;
      duration: number;
      thumbnail: string | null;
    }
  | { valid: false; reason: string; code: string };

export const housePlaylistApi = {
  list: (): Promise<HousePlaylistItem[]> =>
    adminApi.get<HousePlaylistItem[]>("/house-playlist").then((r) => r.data),
  validate: (url: string): Promise<HousePlaylistValidation> =>
    adminApi
      .get<HousePlaylistValidation>("/house-playlist/validate", {
        params: { url },
      })
      .then((r) => r.data),
  create: (
    url: string,
  ): Promise<{ ok: true; item: HousePlaylistItem } | { ok: false; code: string; message: string }> =>
    adminApi
      .post<
        | { ok: true; item: HousePlaylistItem }
        | { ok: false; code: string; message: string }
      >("/house-playlist", { url })
      .then((r) => r.data),
  update: (
    id: number,
    patch: Partial<{ is_active: boolean; sort_order: number; title: string }>,
  ): Promise<HousePlaylistItem> =>
    adminApi
      .patch<HousePlaylistItem>(`/house-playlist/${id}`, patch)
      .then((r) => r.data),
  setItemCategories: (
    id: number,
    categoryIds: number[],
  ): Promise<HousePlaylistItem> =>
    adminApi
      .patch<HousePlaylistItem>(`/house-playlist/${id}/categories`, {
        category_ids: categoryIds,
      })
      .then((r) => r.data),
  remove: (id: number): Promise<{ ok: true }> =>
    adminApi
      .delete<{ ok: true }>(`/house-playlist/${id}`)
      .then((r) => r.data),

  // ─── Categories ─────────────────────────────────────────────────────────
  listCategories: (): Promise<HousePlaylistCategory[]> =>
    adminApi
      .get<HousePlaylistCategory[]>("/house-playlist/categories")
      .then((r) => r.data),
  createCategory: (name: string): Promise<HousePlaylistCategory> =>
    adminApi
      .post<HousePlaylistCategory>("/house-playlist/categories", { name })
      .then((r) => r.data),
  renameCategory: (
    id: number,
    name: string,
  ): Promise<HousePlaylistCategory> =>
    adminApi
      .patch<HousePlaylistCategory>(`/house-playlist/categories/${id}`, {
        name,
      })
      .then((r) => r.data),
  deleteCategory: (id: number): Promise<{ ok: true }> =>
    adminApi
      .delete<{ ok: true }>(`/house-playlist/categories/${id}`)
      .then((r) => r.data),
  getActiveCategory: (): Promise<{ active_category_id: number | null }> =>
    adminApi
      .get<{ active_category_id: number | null }>(
        "/house-playlist/active-category",
      )
      .then((r) => r.data),
  setActiveCategory: (
    categoryId: number | null,
  ): Promise<{ active_category_id: number | null }> =>
    adminApi
      .put<{ active_category_id: number | null }>(
        "/house-playlist/active-category",
        { category_id: categoryId },
      )
      .then((r) => r.data),
};

// ─── Queue ────────────────────────────────────────────────────────────────────
// Reads are public (the TV player has no login). Customer writes use
// `customerApi` (session token). Admin writes use `adminApi`.
export const queueApi = {
  getGlobal: (): Promise<QueueItem[]> =>
    publicApi.get<QueueItem[]>("/queue/global").then((r) => r.data),
  /**
   * Per-table active queue. Pass `since` (ISO timestamp, usually
   * `session.opened_at`) to scope results to the current session — the
   * customer view should never see rows from a previous occupant.
   */
  getByTable: (
    tableId: number,
    opts?: { since?: string },
  ): Promise<QueueItem[]> => {
    const q = new URLSearchParams({ table_id: String(tableId) });
    if (opts?.since) q.set("since", opts.since);
    return customerApi
      .get<QueueItem[]>(`/queue?${q.toString()}`)
      .then((r) => r.data);
  },
  getByTableWithHistory: (
    tableId: number,
    opts?: { since?: string },
  ): Promise<QueueItem[]> => {
    const q = new URLSearchParams({
      table_id: String(tableId),
      include_history: "true",
    });
    if (opts?.since) q.set("since", opts.since);
    return customerApi
      .get<QueueItem[]>(`/queue?${q.toString()}`)
      .then((r) => r.data);
  },
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
export interface MusicBudgetSlot {
  slot: number;
  name: string;
  used: number;
  remaining: number;
  limit: number;
}

export interface MusicBudgetSnapshot {
  cache_size: number;
  slots: MusicBudgetSlot[];
}

// ─── Audit log (admin) ──────────────────────────────────────────────────────
// Mirrors the backend enum AuditEventKind one-to-one. Adding a kind on
// the backend requires updating this union — TS will flag the missing
// label / icon mapping at compile time.
export type AuditEventKind =
  | "login_success"
  | "login_failed"
  | "login_locked"
  | "password_reset_requested"
  | "password_reset_completed"
  | "access_code_rotated"
  | "session_opened_by_admin"
  | "session_marked_paid"
  | "session_closed"
  | "session_voided"
  | "session_partial_payment"
  | "walkin_account_opened"
  | "product_created"
  | "product_updated"
  | "product_activated"
  | "product_deactivated"
  | "inventory_movement"
  | "bill_adjustment";

export interface AuditEvent {
  id: string;
  kind: AuditEventKind;
  created_at: string;
  actor_id: number | null;
  actor_label: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  ip: string | null;
}

export const auditLogApi = {
  list: (limit = 100): Promise<AuditEvent[]> =>
    adminApi
      .get<AuditEvent[]>(`/audit-log?limit=${limit}`)
      .then((r) => r.data),
};

export const musicApi = {
  search: (query: string): Promise<YouTubeSearchResult[]> =>
    publicApi
      .get<YouTubeSearchResult[]>(
        `/music/search?q=${encodeURIComponent(query)}`,
      )
      .then((r) => r.data),
  /**
   * In-memory budget snapshot per YouTube API key. Resets on backend
   * restart — useful for "did I burn my quota in the last hour?" but
   * the source of truth is console.cloud.google.com.
   */
  getBudget: (): Promise<{ snapshot: MusicBudgetSnapshot | null }> =>
    adminApi.get("/music/budget").then((r) => r.data),
};
