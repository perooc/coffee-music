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
  };
  top_selling: ProductSummary[];
  revenue_by_product: ProductSummary[];
  low_rotation: { product_id: number; name: string; category: string; stock: number }[];
  low_stock_high_demand: (ProductSummary & {
    stock: number;
    low_stock_threshold: number;
  })[];
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
    day?: string; // YYYY-MM-DD; default: today
    days?: number; // default 1, range 1..30
    topLimit?: number; // default 5
  }): Promise<SalesInsights> {
    const days = clampDays(opts.days ?? 1);
    const topLimit = clampTopLimit(opts.topLimit ?? 5);

    const { from, to } = resolveRange(opts.day, days);

    // Source rows: only Consumption.type=product, not reversed.
    // We read the rows once and aggregate in memory; even at 10k rows/day
    // this is well under any threshold that would justify a SQL groupBy.
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
      },
    });

    const aggByProduct = new Map<
      number,
      { units: number; revenue: number }
    >();
    for (const c of consumptions) {
      if (c.product_id == null) continue;
      const slot = aggByProduct.get(c.product_id) ?? { units: 0, revenue: 0 };
      slot.units += c.quantity;
      slot.revenue += Number(c.amount);
      aggByProduct.set(c.product_id, slot);
    }

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

    // Low rotation: active product, stock > 0, and 0 sales in the range.
    // We intentionally do not parameterize a "threshold of low" — 0 is
    // unambiguous; the admin decides what to do.
    const lowRotation = allProducts
      .filter((p) => p.is_active && p.stock > 0 && !aggByProduct.has(p.id))
      .map((p) => ({
        product_id: p.id,
        name: p.name,
        category: p.category,
        stock: p.stock,
      }));

    // Low stock + high demand: products that are flagged low/out-of-stock
    // by the admin's own threshold AND have at least one sale in the range.
    // These are the urgent restocks.
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

    const totalUnits = summaries.reduce((a, s) => a + s.units_sold, 0);
    const totalRevenue = round(
      summaries.reduce((a, s) => a + s.revenue, 0),
    );

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
      },
      top_selling: topSelling,
      revenue_by_product: revenueByProduct,
      low_rotation: lowRotation,
      low_stock_high_demand: lowStockHighDemand,
    };
  }
}

function clampDays(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 30) return 30;
  return Math.floor(n);
}

function clampTopLimit(n: number): number {
  if (!Number.isFinite(n)) return 5;
  if (n < 1) return 1;
  if (n > 50) return 50;
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

function parseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    throw new BadRequestException({
      message: "Invalid `day` format, expected YYYY-MM-DD",
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

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
