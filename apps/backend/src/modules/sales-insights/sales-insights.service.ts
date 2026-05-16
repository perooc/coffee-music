import { BadRequestException, Injectable } from "@nestjs/common";
import { ConsumptionType } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

export type ProductSummary = {
  product_id: number;
  name: string;
  category: string;
  units_sold: number;
  revenue: number;
};

export type DailyPoint = {
  /** Local calendar date in YYYY-MM-DD. */
  date: string;
  /** 0=Sunday … 6=Saturday (JS getDay convention). */
  weekday: number;
  units: number;
  revenue: number;
  /** Tickets (sesiones cerradas) que cayeron en ese día. */
  tickets: number;
};

export type HourlyPoint = {
  /** 0..23, local server time. */
  hour: number;
  units: number;
  revenue: number;
};

export type WeekdayPoint = {
  /** 0=Sunday … 6=Saturday. */
  weekday: number;
  avg_units: number;
  avg_revenue: number;
  /** Cuántos días de ese weekday cayeron en el rango (denominador del avg). */
  sample_count: number;
};

export type CategoryPoint = {
  category: string;
  units: number;
  revenue: number;
};

export type PeriodTotals = {
  total_units: number;
  total_revenue: number;
  tickets_count: number;
  avg_ticket: number;
};

export type SalesInsights = {
  range: {
    from: string;
    to: string;
    days: number;
  };
  summary: {
    total_units: number;
    total_revenue: number;
    distinct_products_sold: number;
    tickets_count: number;
    avg_ticket: number;
  };
  /**
   * Mismas métricas, pero del período inmediatamente anterior de igual
   * tamaño. Sirve para mostrar deltas (▲/▼ vs período pasado) sin que el
   * frontend tenga que hacer un segundo round-trip.
   */
  previous_period: PeriodTotals;
  daily_breakdown: DailyPoint[];
  hourly_breakdown: HourlyPoint[];
  weekday_breakdown: WeekdayPoint[];
  revenue_by_category: CategoryPoint[];
  top_selling: ProductSummary[];
  revenue_by_product: ProductSummary[];
  low_rotation: { product_id: number; name: string; category: string; stock: number }[];
  low_stock_high_demand: (ProductSummary & {
    stock: number;
    low_stock_threshold: number;
  })[];
};

// ─── Cuentas cerradas con detalle (tab "Detalle" del admin) ─────────────
export type ClosedSessionLine = {
  consumption_id: number;
  type: ConsumptionType;
  description: string;
  /** Cantidad nominal — refunds vienen con cantidad positiva pero amount negativo. */
  quantity: number;
  unit_amount: number;
  amount: number;
  /** Hora exacta del consumo (ISO). Útil para ordenar dentro de la cuenta. */
  created_at: string;
};

export type ClosedSession = {
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
  /** "paid" | "void" — derivado de paid_at vs voided_at para que el UI no recalcule. */
  outcome: "paid" | "void";
  /** Suma de productos vendidos (positivos). No incluye descuentos/refunds. */
  subtotal: number;
  /** Sumatoria de discount + adjustment + refund (negativos en su mayoría). */
  adjustments_total: number;
  /** Pagos parciales (anticipos, ya negativos en la BD). */
  partial_payments_total: number;
  /** Total final = lo que efectivamente cobró el bar. = total_consumption persistido. */
  total: number;
  /** Líneas del ledger, ordenadas por created_at ascendente. */
  lines: ClosedSessionLine[];
};

export type ClosedSessionsResponse = {
  range: { from: string; to: string; days: number };
  /** Cantidad de cuentas (paid + void) que cayeron en el rango por closed_at. */
  total: number;
  paid_count: number;
  void_count: number;
  /** Total cobrado (solo paid). */
  paid_revenue: number;
  /** Total anulado (cuánta plata se perdió por voids). */
  void_lost_revenue: number;
  sessions: ClosedSession[];
};

// ─── Todos los productos con métricas (tab "Productos" del admin) ──────
export type ProductMetricsRow = {
  product_id: number;
  name: string;
  category: string;
  is_active: boolean;
  stock: number;
  units_sold: number;
  revenue: number;
  avg_ticket: number;
  /** Porcentaje sobre el total de ingresos del rango (0..100, redondeado a 2 dec). */
  revenue_pct: number;
};

export type ProductMetricsResponse = {
  range: { from: string; to: string; days: number };
  total_revenue: number;
  total_units: number;
  /** Total de productos antes de paginar (post-filtro). Para mostrar "viendo 1–20 de 87". */
  total: number;
  page: number;
  page_size: number;
  rows: ProductMetricsRow[];
};

export type ProductSalesHistory = {
  product: {
    id: number;
    name: string;
    category: string;
  };
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

/**
 * Reads sales aggregates from Consumption (the ledger), NEVER from OrderItem
 * directly. Why:
 *   - cancelled orders never produced a Consumption row, so they cannot
 *     inflate sales numbers.
 *   - refunds (Consumption.type='refund', or rows with `reversed_at`) are
 *     deliberately excluded so the figures match what the bar actually
 *     collected.
 *   - the same source backs the bill view, so "vendido hoy" and the live
 *     bills can never diverge.
 */
@Injectable()
export class SalesInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInsights(opts: {
    /** Calendar day YYYY-MM-DD; default: today. Ignored if `from`/`to`. */
    day?: string;
    /** Default 1, range 1..30. Ignored if `from`/`to` están presentes. */
    days?: number;
    /** Custom range start (YYYY-MM-DD, inclusivo). */
    from?: string;
    /** Custom range end (YYYY-MM-DD, inclusivo). */
    to?: string;
    /** Default 5, range 1..50. */
    topLimit?: number;
  }): Promise<SalesInsights> {
    const topLimit = clampTopLimit(opts.topLimit ?? 5);

    // Custom range gana sobre `day`/`days`. Validamos coherencia (ambos o
    // ninguno) — si vino solo uno, error 400.
    let from: Date;
    let to: Date;
    let days: number;
    if (opts.from || opts.to) {
      if (!opts.from || !opts.to) {
        throw new BadRequestException({
          message: "Both `from` and `to` are required for custom ranges",
          code: "SALES_INVALID_RANGE",
        });
      }
      const range = resolveCustomRange(opts.from, opts.to);
      from = range.from;
      to = range.to;
      days = range.days;
    } else {
      days = clampDays(opts.days ?? 1);
      const range = resolveRange(opts.day, days);
      from = range.from;
      to = range.to;
    }

    // Período anterior de igual tamaño para deltas (▲/▼ vs período pasado).
    // Cubre [previousFrom, from) — pegado al actual sin solaparse.
    const previousFrom = addDays(from, -days);
    const previousTo = from;

    // Cargamos TODAS las consumptions del rango actual + previo en una
    // sola query. Evitamos dos round-trips a Postgres y agregamos en
    // memoria — para 30 días incluso de un bar lleno son <50k filas.
    const allConsumptions = await this.prisma.consumption.findMany({
      where: {
        type: ConsumptionType.product,
        product_id: { not: null },
        reversed_at: null,
        created_at: { gte: previousFrom, lt: to },
      },
      select: {
        product_id: true,
        quantity: true,
        amount: true,
        created_at: true,
        table_session_id: true,
      },
    });

    // Particionamos por rango. `created_at >= from` separa actual vs
    // previo (porque previousTo === from).
    const currentRows = allConsumptions.filter((c) => c.created_at >= from);
    const previousRows = allConsumptions.filter((c) => c.created_at < from);

    const allProducts = await this.prisma.product.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        stock: true,
        is_active: true,
        low_stock_threshold: true,
      },
    });
    const productsById = new Map(allProducts.map((p) => [p.id, p]));

    // ─── Agregaciones del período actual ─────────────────────────────
    const aggByProduct = new Map<
      number,
      { units: number; revenue: number }
    >();
    const dailyMap = new Map<
      string,
      { date: string; weekday: number; units: number; revenue: number }
    >();
    const hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      units: 0,
      revenue: 0,
    }));
    const categoryMap = new Map<string, { units: number; revenue: number }>();
    const sessionsByDay = new Map<string, Set<number>>();

    for (const c of currentRows) {
      if (c.product_id == null) continue;
      const product = productsById.get(c.product_id);
      const dateKey = formatDayKey(c.created_at);
      const weekday = c.created_at.getDay();
      const amount = Number(c.amount);

      // Por producto.
      const slot = aggByProduct.get(c.product_id) ?? { units: 0, revenue: 0 };
      slot.units += c.quantity;
      slot.revenue += amount;
      aggByProduct.set(c.product_id, slot);

      // Por día.
      const daySlot = dailyMap.get(dateKey) ?? {
        date: dateKey,
        weekday,
        units: 0,
        revenue: 0,
      };
      daySlot.units += c.quantity;
      daySlot.revenue += amount;
      dailyMap.set(dateKey, daySlot);

      // Por hora (0..23).
      hourly[c.created_at.getHours()].units += c.quantity;
      hourly[c.created_at.getHours()].revenue += amount;

      // Por categoría — si el producto fue eliminado de la BD lo
      // agrupamos en "Sin categoría" para no perder la venta del total.
      const catKey = product?.category ?? "Sin categoría";
      const catSlot = categoryMap.get(catKey) ?? { units: 0, revenue: 0 };
      catSlot.units += c.quantity;
      catSlot.revenue += amount;
      categoryMap.set(catKey, catSlot);

      // Sesiones únicas por día (para tickets).
      let sessionsOfDay = sessionsByDay.get(dateKey);
      if (!sessionsOfDay) {
        sessionsOfDay = new Set<number>();
        sessionsByDay.set(dateKey, sessionsOfDay);
      }
      sessionsOfDay.add(c.table_session_id);
    }

    const summaries: ProductSummary[] = [];
    for (const [pid, agg] of aggByProduct) {
      const p = productsById.get(pid);
      if (!p) continue;
      summaries.push({
        product_id: pid,
        name: p.name,
        category: p.category,
        units_sold: agg.units,
        revenue: round(agg.revenue),
      });
    }

    const topSelling = [...summaries]
      .sort((a, b) => b.units_sold - a.units_sold)
      .slice(0, topLimit);
    const revenueByProduct = [...summaries]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, topLimit);

    const lowRotation = allProducts
      .filter((p) => p.is_active && p.stock > 0 && !aggByProduct.has(p.id))
      .map((p) => ({
        product_id: p.id,
        name: p.name,
        category: p.category,
        stock: p.stock,
      }));

    const lowStockHighDemand = topSelling
      .map((s) => {
        const p = productsById.get(s.product_id);
        if (!p) return null;
        const isLow =
          (p.low_stock_threshold > 0 && p.stock <= p.low_stock_threshold) ||
          p.stock <= 0;
        if (!isLow) return null;
        return {
          ...s,
          stock: p.stock,
          low_stock_threshold: p.low_stock_threshold,
        };
      })
      .filter(
        (
          x,
        ): x is ProductSummary & {
          stock: number;
          low_stock_threshold: number;
        } => x != null,
      );

    // Daily breakdown: rellenamos los días que no tuvieron ventas con
    // ceros — el frontend espera un punto por cada día del rango para
    // que el bar chart no tenga huecos visuales.
    const dailyBreakdown: DailyPoint[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const key = formatDayKey(d);
      const slot = dailyMap.get(key);
      const tickets = sessionsByDay.get(key)?.size ?? 0;
      dailyBreakdown.push({
        date: key,
        weekday: d.getDay(),
        units: slot?.units ?? 0,
        revenue: round(slot?.revenue ?? 0),
        tickets,
      });
    }

    // Weekday avg: cada día del rango aporta a un bucket. El avg es
    // total_del_bucket / cantidad_de_días_en_ese_bucket. Para 7 días el
    // sample_count será 1 por weekday; para 30 días, ~4-5 por weekday.
    const weekdayAgg = Array.from({ length: 7 }, () => ({
      units: 0,
      revenue: 0,
      sample_count: 0,
    }));
    for (const d of dailyBreakdown) {
      weekdayAgg[d.weekday].units += d.units;
      weekdayAgg[d.weekday].revenue += d.revenue;
      weekdayAgg[d.weekday].sample_count += 1;
    }
    const weekdayBreakdown: WeekdayPoint[] = weekdayAgg.map((w, weekday) => ({
      weekday,
      avg_units: w.sample_count > 0 ? round(w.units / w.sample_count) : 0,
      avg_revenue: w.sample_count > 0 ? round(w.revenue / w.sample_count) : 0,
      sample_count: w.sample_count,
    }));

    const revenueByCategory: CategoryPoint[] = Array.from(
      categoryMap.entries(),
    )
      .map(([category, agg]) => ({
        category,
        units: agg.units,
        revenue: round(agg.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Tickets totales del período = unión de sesiones que hicieron al
    // menos una venta. NO contamos sesiones cerradas porque una sesión
    // sin ventas (cliente que entró y salió sin consumir) no es un
    // "ticket" desde el punto de vista comercial.
    const allSessionIds = new Set<number>();
    for (const set of sessionsByDay.values()) {
      for (const id of set) allSessionIds.add(id);
    }
    const ticketsCount = allSessionIds.size;

    const totalUnits = summaries.reduce((a, s) => a + s.units_sold, 0);
    const totalRevenue = round(
      summaries.reduce((a, s) => a + s.revenue, 0),
    );
    const avgTicket = ticketsCount > 0 ? round(totalRevenue / ticketsCount) : 0;

    // ─── Período anterior ────────────────────────────────────────────
    const prevSessionIds = new Set<number>();
    let prevUnits = 0;
    let prevRevenue = 0;
    for (const c of previousRows) {
      prevUnits += c.quantity;
      prevRevenue += Number(c.amount);
      prevSessionIds.add(c.table_session_id);
    }
    const prevTickets = prevSessionIds.size;
    const previousPeriod: PeriodTotals = {
      total_units: prevUnits,
      total_revenue: round(prevRevenue),
      tickets_count: prevTickets,
      avg_ticket: prevTickets > 0 ? round(prevRevenue / prevTickets) : 0,
    };

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        days,
      },
      summary: {
        total_units: totalUnits,
        total_revenue: totalRevenue,
        distinct_products_sold: summaries.length,
        tickets_count: ticketsCount,
        avg_ticket: avgTicket,
      },
      previous_period: previousPeriod,
      daily_breakdown: dailyBreakdown,
      hourly_breakdown: hourly.map((h) => ({
        hour: h.hour,
        units: h.units,
        revenue: round(h.revenue),
      })),
      weekday_breakdown: weekdayBreakdown,
      revenue_by_category: revenueByCategory,
      top_selling: topSelling,
      revenue_by_product: revenueByProduct,
      low_rotation: lowRotation,
      low_stock_high_demand: lowStockHighDemand,
    };
  }

  /**
   * Histórico de ventas de un producto específico, día por día.
   *
   * Default: últimos 60 días — suficientes 8-9 sábados/domingos para
   * detectar patrones de fin de semana sin saturar el bar chart.
   *
   * Opción A confirmada: usamos el nombre/categoría ACTUAL del producto
   * (lo que retorna `findUnique`), no el nombre histórico que quedó en
   * `Consumption.description`. Si el operador renombró "Cerveza Águila
   * Litro" a "Águila 1L", el histórico aparece bajo el nombre nuevo.
   */
  async getProductHistory(opts: {
    productId: number;
    days?: number;
    from?: string;
    to?: string;
  }): Promise<ProductSalesHistory> {
    const product = await this.prisma.product.findUnique({
      where: { id: opts.productId },
      select: { id: true, name: true, category: true },
    });
    if (!product) {
      throw new BadRequestException({
        message: "Product not found",
        code: "SALES_PRODUCT_NOT_FOUND",
      });
    }

    let from: Date;
    let to: Date;
    let days: number;
    if (opts.from || opts.to) {
      if (!opts.from || !opts.to) {
        throw new BadRequestException({
          message: "Both `from` and `to` are required for custom ranges",
          code: "SALES_INVALID_RANGE",
        });
      }
      const range = resolveCustomRange(opts.from, opts.to);
      from = range.from;
      to = range.to;
      days = range.days;
    } else {
      days = clampHistoryDays(opts.days ?? 60);
      const today = startOfDay(new Date());
      to = addDays(today, 1);
      from = addDays(to, -days);
    }

    const rows = await this.prisma.consumption.findMany({
      where: {
        product_id: opts.productId,
        type: ConsumptionType.product,
        reversed_at: null,
        created_at: { gte: from, lt: to },
      },
      select: { quantity: true, amount: true, created_at: true },
    });

    const dailyMap = new Map<string, { units: number; revenue: number }>();
    let totalUnits = 0;
    let totalRevenue = 0;
    for (const r of rows) {
      const key = formatDayKey(r.created_at);
      const amount = Number(r.amount);
      const slot = dailyMap.get(key) ?? { units: 0, revenue: 0 };
      slot.units += r.quantity;
      slot.revenue += amount;
      dailyMap.set(key, slot);
      totalUnits += r.quantity;
      totalRevenue += amount;
    }

    const dailySales: ProductSalesHistory["daily_sales"] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const key = formatDayKey(d);
      const slot = dailyMap.get(key);
      dailySales.push({
        date: key,
        weekday: d.getDay(),
        units: slot?.units ?? 0,
        revenue: round(slot?.revenue ?? 0),
      });
    }

    const weekdayAgg = Array.from({ length: 7 }, () => ({
      units: 0,
      revenue: 0,
      sample_count: 0,
    }));
    for (const d of dailySales) {
      weekdayAgg[d.weekday].units += d.units;
      weekdayAgg[d.weekday].revenue += d.revenue;
      weekdayAgg[d.weekday].sample_count += 1;
    }
    const weekdayAvg: ProductSalesHistory["weekday_avg"] = weekdayAgg.map(
      (w, weekday) => ({
        weekday,
        avg_units: w.sample_count > 0 ? round(w.units / w.sample_count) : 0,
        avg_revenue: w.sample_count > 0 ? round(w.revenue / w.sample_count) : 0,
        sample_count: w.sample_count,
      }),
    );

    return {
      product,
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        days,
      },
      daily_sales: dailySales,
      weekday_avg: weekdayAvg,
      totals: { units: totalUnits, revenue: round(totalRevenue) },
    };
  }

  /**
   * Cuentas cerradas en el rango — pagadas + anuladas (void), con el
   * detalle del ledger por cuenta. La vista "Detalle" del admin usa
   * esto como su lista principal: una fila por cuenta, expandible.
   *
   * Decisiones:
   *   - Filtramos por `closed_at` (no por `created_at` del consumption):
   *     una cuenta abierta a las 23:55 y pagada a las 01:10 pertenece al
   *     día siguiente desde la perspectiva del cierre. Es lo que el
   *     operador espera al revisar "ventas del lunes".
   *   - Devolvemos sesiones `paid` Y `void`. La UI las distingue con un
   *     badge; el operador pidió ver anuladas.
   *   - Las líneas vienen ordenadas por `created_at` para reconstruir la
   *     secuencia real de cobros (como si fuera el ticket impreso).
   *   - Sin paginación todavía: 1 día de bar lleno son ~80 cuentas; 30
   *     días serían ~2400. Si en producción se vuelve pesado, agregamos
   *     `page`/`page_size` aquí siguiendo el patrón del endpoint de
   *     productos.
   */
  async getClosedSessions(opts: {
    day?: string;
    days?: number;
    from?: string;
    to?: string;
  }): Promise<ClosedSessionsResponse> {
    const { from, to, days } = this.resolveRangeOrCustom(opts);

    const sessions = await this.prisma.tableSession.findMany({
      where: {
        OR: [
          { paid_at: { not: null, gte: from, lt: to } },
          { voided_at: { not: null, gte: from, lt: to } },
        ],
      },
      orderBy: { closed_at: "desc" },
      include: {
        table: {
          select: { id: true, number: true, kind: true },
        },
        consumptions: {
          orderBy: { created_at: "asc" },
          select: {
            id: true,
            type: true,
            description: true,
            quantity: true,
            unit_amount: true,
            amount: true,
            created_at: true,
          },
        },
      },
    });

    let paidCount = 0;
    let voidCount = 0;
    let paidRevenue = 0;
    let voidLostRevenue = 0;
    const result: ClosedSession[] = sessions.map((s) => {
      const outcome: "paid" | "void" = s.voided_at ? "void" : "paid";
      let subtotal = 0;
      let adjustments = 0;
      let partials = 0;
      const lines: ClosedSessionLine[] = s.consumptions.map((c) => {
        const amount = Number(c.amount);
        switch (c.type) {
          case ConsumptionType.product:
            subtotal += amount;
            break;
          case ConsumptionType.discount:
          case ConsumptionType.adjustment:
          case ConsumptionType.refund:
            adjustments += amount;
            break;
          case ConsumptionType.partial_payment:
            partials += amount;
            break;
        }
        return {
          consumption_id: c.id,
          type: c.type,
          description: c.description,
          quantity: c.quantity,
          unit_amount: Number(c.unit_amount),
          amount,
          created_at: c.created_at.toISOString(),
        };
      });
      const total = Number(s.total_consumption);
      if (outcome === "paid") {
        paidCount += 1;
        paidRevenue += total;
      } else {
        voidCount += 1;
        // Lo "perdido" en void = suma de productos (subtotal). Si el
        // void cayó después de un refund parcial, el subtotal ya refleja
        // las ventas vigentes y es el número que el operador querrá ver.
        voidLostRevenue += subtotal;
      }
      return {
        session_id: s.id,
        table_id: s.table_id,
        table_number: s.table?.number ?? null,
        table_kind: (s.table?.kind ?? "TABLE") as "TABLE" | "BAR",
        custom_name: s.custom_name,
        opened_at: s.opened_at.toISOString(),
        closed_at: s.closed_at ? s.closed_at.toISOString() : null,
        paid_at: s.paid_at ? s.paid_at.toISOString() : null,
        voided_at: s.voided_at ? s.voided_at.toISOString() : null,
        void_reason: s.void_reason,
        void_other_detail: s.void_other_detail,
        outcome,
        subtotal: round(subtotal),
        adjustments_total: round(adjustments),
        partial_payments_total: round(partials),
        total: round(total),
        lines,
      };
    });

    return {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      total: result.length,
      paid_count: paidCount,
      void_count: voidCount,
      paid_revenue: round(paidRevenue),
      void_lost_revenue: round(voidLostRevenue),
      sessions: result,
    };
  }

  /**
   * Catálogo completo con métricas de ventas en el rango. Soporta:
   *   - buscador por nombre/categoría (`search`)
   *   - orden por revenue (default), units, name, category
   *   - paginado server-side (page/page_size; defaults: 1, 20)
   *
   * Productos sin ventas en el rango aparecen con units=0/revenue=0; el
   * operador los necesita para detectar SKUs muertos y para mostrar
   * inventario que existe pero no se vende.
   */
  async getAllProductsMetrics(opts: {
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
  }): Promise<ProductMetricsResponse> {
    const { from, to, days } = this.resolveRangeOrCustom(opts);

    const sort = opts.sort ?? "revenue";
    const direction = opts.direction ?? "desc";
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    const pageSize = clampPageSize(opts.page_size ?? 20);
    const search = opts.search?.trim().toLowerCase() ?? "";
    const includeInactive = opts.include_inactive ?? false;

    const consumptions = await this.prisma.consumption.findMany({
      where: {
        type: ConsumptionType.product,
        product_id: { not: null },
        reversed_at: null,
        created_at: { gte: from, lt: to },
      },
      select: {
        product_id: true,
        quantity: true,
        amount: true,
        table_session_id: true,
      },
    });

    const productAgg = new Map<
      number,
      { units: number; revenue: number; sessions: Set<number> }
    >();
    let totalRevenue = 0;
    let totalUnits = 0;
    for (const c of consumptions) {
      if (c.product_id == null) continue;
      const slot = productAgg.get(c.product_id) ?? {
        units: 0,
        revenue: 0,
        sessions: new Set<number>(),
      };
      const amount = Number(c.amount);
      slot.units += c.quantity;
      slot.revenue += amount;
      slot.sessions.add(c.table_session_id);
      productAgg.set(c.product_id, slot);
      totalRevenue += amount;
      totalUnits += c.quantity;
    }

    const products = await this.prisma.product.findMany({
      where: includeInactive ? {} : { is_active: true },
      select: {
        id: true,
        name: true,
        category: true,
        is_active: true,
        stock: true,
      },
    });

    let rows: ProductMetricsRow[] = products.map((p) => {
      const agg = productAgg.get(p.id);
      const units = agg?.units ?? 0;
      const revenue = round(agg?.revenue ?? 0);
      const sessionsCount = agg?.sessions.size ?? 0;
      return {
        product_id: p.id,
        name: p.name,
        category: p.category,
        is_active: p.is_active,
        stock: p.stock,
        units_sold: units,
        revenue,
        avg_ticket: sessionsCount > 0 ? round(revenue / sessionsCount) : 0,
        revenue_pct:
          totalRevenue > 0 ? round((revenue / totalRevenue) * 100) : 0,
      };
    });

    if (search) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(search) ||
          r.category.toLowerCase().includes(search),
      );
    }

    rows.sort((a, b) => {
      const mul = direction === "asc" ? 1 : -1;
      switch (sort) {
        case "units":
          return (a.units_sold - b.units_sold) * mul;
        case "name":
          return a.name.localeCompare(b.name, "es") * mul;
        case "category":
          return a.category.localeCompare(b.category, "es") * mul;
        case "revenue":
        default:
          return (a.revenue - b.revenue) * mul;
      }
    });

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    return {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      total_revenue: round(totalRevenue),
      total_units: totalUnits,
      total,
      page,
      page_size: pageSize,
      rows: pageRows,
    };
  }

  /**
   * Resuelve from/to/days desde las opciones (day/days o from/to). DRY:
   * lo usan getInsights, getClosedSessions y getAllProductsMetrics.
   */
  private resolveRangeOrCustom(opts: {
    day?: string;
    days?: number;
    from?: string;
    to?: string;
  }): { from: Date; to: Date; days: number } {
    if (opts.from || opts.to) {
      if (!opts.from || !opts.to) {
        throw new BadRequestException({
          message: "Both `from` and `to` are required for custom ranges",
          code: "SALES_INVALID_RANGE",
        });
      }
      return resolveCustomRange(opts.from, opts.to);
    }
    const days = clampDays(opts.days ?? 1);
    const range = resolveRange(opts.day, days);
    return { from: range.from, to: range.to, days };
  }
}

function clampDays(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 30) return 30;
  return Math.floor(n);
}

/**
 * Histórico por producto admite hasta 366 días (1 año) para que el
 * operador pueda comparar trimestres / temporadas. Más allá de eso el
 * gráfico se vuelve ilegible y la query empieza a pesar.
 */
function clampHistoryDays(n: number): number {
  if (!Number.isFinite(n)) return 60;
  if (n < 1) return 1;
  if (n > 366) return 366;
  return Math.floor(n);
}

function clampTopLimit(n: number): number {
  if (!Number.isFinite(n)) return 5;
  if (n < 1) return 1;
  if (n > 50) return 50;
  return Math.floor(n);
}

function clampPageSize(n: number): number {
  if (!Number.isFinite(n)) return 20;
  if (n < 1) return 1;
  // Tope alto: el operador a veces querrá ver "todos" en una página.
  // 200 alcanza para catálogos típicos y mantiene el payload manejable.
  if (n > 200) return 200;
  return Math.floor(n);
}

function resolveRange(
  dayStr: string | undefined,
  days: number,
): { from: Date; to: Date } {
  // `to` is exclusive; `from` is inclusive. We work in local server time so
  // "hoy" matches the bar's clock. If a `day` is supplied it is interpreted
  // as that calendar day's start.
  const ref = dayStr ? parseDay(dayStr) : startOfDay(new Date());
  const to = addDays(ref, 1);
  const from = addDays(to, -days);
  return { from, to };
}

/**
 * Custom range — `from` y `to` son ambos inclusivos para el operador
 * ("del 1 al 7 de mayo" significa que el 7 cuenta), pero internamente
 * tratamos `to` como exclusivo (lo movemos +1 día) para que la query
 * `created_at < to` capture todo el día final completo.
 */
function resolveCustomRange(
  fromStr: string,
  toStr: string,
): { from: Date; to: Date; days: number } {
  const fromDate = parseDay(fromStr);
  const toInclusive = parseDay(toStr);
  if (toInclusive < fromDate) {
    throw new BadRequestException({
      message: "`to` must be on or after `from`",
      code: "SALES_INVALID_RANGE",
    });
  }
  const to = addDays(toInclusive, 1);
  const days = Math.round((to.getTime() - fromDate.getTime()) / 86_400_000);
  if (days > 366) {
    throw new BadRequestException({
      message: "Date range too large (max 366 days)",
      code: "SALES_RANGE_TOO_LARGE",
    });
  }
  return { from: fromDate, to, days };
}

function parseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    throw new BadRequestException({
      message: "Invalid date format, expected YYYY-MM-DD",
      code: "SALES_INVALID_DAY",
    });
  }
  const [_, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      message: "Invalid calendar day",
      code: "SALES_INVALID_DAY",
    });
  }
  return date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/**
 * Format a Date as `YYYY-MM-DD` using LOCAL components (not UTC).
 * Crítico: si usáramos `toISOString().slice(0,10)` un consumo de las
 * 9 PM en zona horaria GMT-5 se contabilizaría al día siguiente.
 */
function formatDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
