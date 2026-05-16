"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  salesInsightsApi,
  type ClosedSessionApi,
  type ClosedSessionLineApi,
  type ClosedSessionLineUnitApi,
  type ClosedSessionsResponse,
  type ProductMetricsResponse,
  type ProductMetricsRowApi,
  type ProductSalesSummary,
  type SalesInsightsResponse,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { useSocket } from "@/lib/socket/useSocket";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  fmt,
  btnGhost,
  btnPrimary,
  BUTTON_STYLES,
  DUR_BASE,
  DUR_SLOW,
} from "@/lib/theme";

// Presets ofrecidos en el filtro. Los simples (`today`, `7d`, `30d`)
// viajan al backend como `?days=N`. Los calendario-relativos (`yesterday`,
// `this_month`, `last_month`) computan from/to en el cliente y van como
// custom range — el backend los procesa con la misma rama de validación.
type RangePreset =
  | "today"
  | "yesterday"
  | "7d"
  | "this_month"
  | "last_month"
  | "30d"
  | "custom";

type DateRange =
  | { kind: "preset"; preset: Exclude<RangePreset, "custom">; days?: number; from?: string; to?: string }
  | { kind: "custom"; from: string; to: string };

const DEFAULT_RANGE: DateRange = {
  kind: "preset",
  preset: "today",
  days: 1,
};

type TabKey = "summary" | "detail" | "products";

const TAB_STORAGE_KEY = "admin_sales_tab";

export default function AdminSalesPage() {
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [data, setData] = useState<SalesInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Persistimos la última pestaña en sessionStorage para que un refresh
  // del navegador devuelva al operador al mismo sitio. No usamos query
  // string para evitar reload del componente al cambiar de tab.
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "summary";
    const stored = window.sessionStorage.getItem(TAB_STORAGE_KEY);
    if (stored === "summary" || stored === "detail" || stored === "products") {
      return stored;
    }
    return "summary";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Traducimos el DateRange al wire format. Si el preset trae `from`/`to`
      // computados (yesterday, this_month, last_month), los priorizamos sobre
      // `days` — el backend ignora `days` cuando recibe ambos endpoints.
      const params: Parameters<typeof salesInsightsApi.get>[0] =
        range.kind === "custom"
          ? { from: range.from, to: range.to }
          : range.from && range.to
            ? { from: range.from, to: range.to }
            : { days: range.days };
      const res = await salesInsightsApi.get(params);
      setData(res);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-refresh por socket: cuando llega un evento de venta-relacionada
  // (orden entregada, refund, ajuste), reagendamos un refetch con
  // debounce. El debounce evita martillear el backend si entregan 5
  // pedidos seguidos al iniciar el bar (5 eventos en 2s = 1 refetch).
  //
  // Indicador "live": el flag `liveJustRefreshed` se prende 1.2s después
  // del refetch para mostrar feedback visual sutil de que el dashboard
  // está vivo (pulse dorado en el header del KPI strip).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveJustRefreshed, setLiveJustRefreshed] = useState(false);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void refreshRef.current().then(() => {
        setLiveJustRefreshed(true);
        setTimeout(() => setLiveJustRefreshed(false), 1200);
      });
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useSocket({
    staff: true,
    // Una venta confirmada = orden que pasa a delivered. El payload
    // viene como Order parcial; cuando `status === "delivered"` sabemos
    // que el ledger acaba de recibir uno o más Consumption(product).
    onOrderUpdated: (payload) => {
      const status = (payload as { status?: string } | null)?.status;
      if (status === "delivered") scheduleRefresh();
    },
    // Refunds y ajustes alteran ingresos del día (refund excluye una
    // venta; ajustes/descuentos no, pero el bill view sí cambia).
    onBillUpdated: () => scheduleRefresh(),
    // Cuando una sesión cierra, los tickets cambian (avg_ticket nuevo).
    onTableSessionClosed: () => scheduleRefresh(),
  });

  return (
    <>
    <style>{BUTTON_STYLES}</style>
    <main
      style={{
        minHeight: "100dvh",
        background: C.cream,
        color: C.ink,
        fontFamily: FONT_UI,
        padding: "20px 24px 40px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 3,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            — Crown Bar 4.90
          </span>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 26,
              color: C.ink,
              letterSpacing: 4,
              margin: "2px 0 0",
              textTransform: "uppercase",
            }}
          >
            Ventas
          </h1>
        </div>
        <Link
          href="/admin"
          className="crown-btn crown-btn-ghost"
          style={{
            ...btnGhost({ fg: C.cacao, border: C.sand }),
            textDecoration: "none",
          }}
        >
          ← Tablero
        </Link>
      </header>

      <RangeFilter value={range} onChange={setRange} />
      <TabBar value={tab} onChange={setTab} />

      {error && (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 8,
            background: C.terracottaSoft,
            color: C.terracotta,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {loading && !data && (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.mute,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Cargando...
        </div>
      )}

      {data && tab === "summary" && (
        <>
          <SalesKpiStrip
            summary={data.summary}
            previous={data.previous_period}
            daily={data.daily_breakdown}
            justRefreshed={liveJustRefreshed}
          />

          {/* Tendencias: gráficos del comportamiento temporal del bar.
              `auto-fit, minmax(360px,1fr)` colapsa a una columna en
              pantallas chicas y se reorganiza solo en grandes. */}
          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              marginBottom: 16,
            }}
          >
            <Panel title="Ingresos por día">
              {data.daily_breakdown.length === 0 ? (
                <Empty text="Sin datos en el rango" />
              ) : (
                <DailyRevenueChart points={data.daily_breakdown} />
              )}
            </Panel>
            <Panel title="Promedio por día de semana">
              <WeekdayChart points={data.weekday_breakdown} />
            </Panel>
            <Panel title="Picos por hora">
              <HourlyChart points={data.hourly_breakdown} />
            </Panel>
          </div>

          {/* Hero accionable: lo único de la página que requiere acción
              inmediata del operador. Lo elevamos a su propio bloque (full
              width, borde terracotta más grueso) para que se distinga de
              los paneles informativos de abajo. */}
          {data.low_stock_high_demand.length > 0 && (
            <RestockHero items={data.low_stock_high_demand} />
          )}

          {/* Listas informativas — agrupadas en grid 2x2 (auto-fit). El
              operador las consulta cuando quiere panorama, no para tomar
              acción inmediata. Por eso van DESPUÉS del hero. */}
          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              marginBottom: 16,
            }}
          >
            <Panel title="Más vendidos">
              {data.top_selling.length === 0 ? (
                <Empty text="Sin ventas en el rango" />
              ) : (
                <ProductTable rows={data.top_selling} mode="units" />
              )}
            </Panel>

            <Panel title="Ingresos por producto">
              {data.revenue_by_product.length === 0 ? (
                <Empty text="Sin ingresos en el rango" />
              ) : (
                <ProductTable rows={data.revenue_by_product} mode="revenue" />
              )}
            </Panel>
          </div>

          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            }}
          >
            <Panel title="Por categoría">
              {data.revenue_by_category.length === 0 ? (
                <Empty text="Sin ventas en el rango" />
              ) : (
                <CategoryList rows={data.revenue_by_category} />
              )}
            </Panel>

            <Panel title="Sin rotación (con stock, 0 ventas)">
              {data.low_rotation.length === 0 ? (
                <Empty text="Todo está rotando" />
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {data.low_rotation.map((p) => (
                    <li
                      key={p.product_id}
                      style={{
                        borderBottom: `1px solid ${C.sand}`,
                      }}
                    >
                      <ProductLink productId={p.product_id}>
                        <div>
                          <div
                            style={{
                              fontFamily: FONT_DISPLAY,
                              fontSize: 16,
                              color: C.ink,
                              letterSpacing: 0.5,
                            }}
                          >
                            {p.name}
                          </div>
                          <div
                            style={{
                              fontFamily: FONT_MONO,
                              fontSize: 10,
                              letterSpacing: 1.5,
                              color: C.mute,
                              textTransform: "uppercase",
                            }}
                          >
                            {p.category} · stock {p.stock}
                          </div>
                        </div>
                      </ProductLink>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}

      {tab === "detail" && <DetailTab range={range} liveTick={liveJustRefreshed} />}
      {tab === "products" && <ProductsTab range={range} liveTick={liveJustRefreshed} />}
    </main>
    </>
  );
}

// ─── Tab bar ────────────────────────────────────────────────────────────────
function TabBar({
  value,
  onChange,
}: {
  value: TabKey;
  onChange: (v: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string; hint: string }[] = [
    { key: "summary", label: "Resumen", hint: "KPIs, charts y rankings" },
    { key: "detail", label: "Detalle", hint: "Cuentas cerradas con líneas" },
    { key: "products", label: "Productos", hint: "Catálogo con métricas" },
  ];
  return (
    <nav
      role="tablist"
      aria-label="Vistas de ventas"
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 14,
        borderBottom: `1px solid ${C.sand}`,
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.hint}
            onClick={() => onChange(t.key)}
            style={{
              padding: "10px 16px",
              border: "none",
              background: "transparent",
              fontFamily: FONT_UI,
              fontSize: 14,
              letterSpacing: 0.2,
              color: active ? C.ink : C.mute,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              borderBottom: `2px solid ${active ? C.gold : "transparent"}`,
              marginBottom: -1,
              whiteSpace: "nowrap",
              transition: `color ${DUR_BASE}ms ease, border-color ${DUR_BASE}ms ease`,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Range filter ───────────────────────────────────────────────────────────
//
// Presets + custom range. Los presets calendario-relativos (yesterday,
// this_month, last_month) se traducen a `from`/`to` en el cliente —
// internamente todo viaja como custom range al backend, que tiene UNA
// rama de validación. Solo "Hoy / 7 días / 30 días" usan `?days=N` por
// compatibilidad con la lógica existente del service.
//
// El "Personalizado" abre dos `<input type="date">` nativos. No usamos
// librería de date-picker — el control nativo del browser es suficiente
// para el caso de uso (escoger un from/to puntual cada cierto tiempo).
const PRESETS: {
  key: Exclude<RangePreset, "custom">;
  label: string;
}[] = [
  { key: "today", label: "Hoy" },
  { key: "yesterday", label: "Ayer" },
  { key: "7d", label: "7 días" },
  { key: "this_month", label: "Este mes" },
  { key: "last_month", label: "Mes pasado" },
  { key: "30d", label: "30 días" },
];

function RangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const isCustom = value.kind === "custom";
  const activePreset =
    value.kind === "preset" ? value.preset : ("custom" as const);

  // Borradores del custom range — el operador puede tipear ambos campos
  // antes de aplicar. Se inicializan con el rango activo si ya estaba en
  // custom, o con "últimos 7 días" como punto de partida razonable.
  const [draftFrom, setDraftFrom] = useState<string>(() =>
    value.kind === "custom" ? value.from : isoDay(addDaysLocal(today(), -6)),
  );
  const [draftTo, setDraftTo] = useState<string>(() =>
    value.kind === "custom" ? value.to : isoDay(today()),
  );
  const [customError, setCustomError] = useState<string | null>(null);

  function pickPreset(key: Exclude<RangePreset, "custom">) {
    onChange(buildPresetRange(key));
    setCustomError(null);
  }

  function applyCustom() {
    if (!draftFrom || !draftTo) {
      setCustomError("Falta una fecha");
      return;
    }
    if (draftTo < draftFrom) {
      setCustomError("Fin debe ser igual o posterior al inicio");
      return;
    }
    setCustomError(null);
    onChange({ kind: "custom", from: draftFrom, to: draftTo });
  }

  return (
    <section
      style={{
        marginBottom: 18,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
            marginRight: 4,
            fontWeight: 700,
          }}
        >
          Rango:
        </span>
        {PRESETS.map((p) => {
          const active = activePreset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => pickPreset(p.key)}
              className="crown-btn"
              aria-pressed={active}
              style={chipStyle(active)}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange({ kind: "custom", from: draftFrom, to: draftTo })}
          className="crown-btn"
          aria-pressed={isCustom}
          style={chipStyle(isCustom)}
        >
          Personalizado
        </button>
      </div>

      {isCustom && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            padding: "10px 12px",
            background: C.paper,
            border: `1px solid ${C.sand}`,
            borderRadius: 12,
          }}
        >
          <DateField
            label="Desde"
            value={draftFrom}
            onChange={setDraftFrom}
          />
          <DateField label="Hasta" value={draftTo} onChange={setDraftTo} />
          <button
            type="button"
            onClick={applyCustom}
            className="crown-btn crown-btn-primary"
            style={btnPrimary({ bg: C.gold, fg: C.paper })}
          >
            Aplicar
          </button>
          {customError && (
            <span
              role="alert"
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1.5,
                color: C.terracotta,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {customError}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 999,
    border: `1px solid ${active ? C.ink : C.sand}`,
    background: active ? C.ink : C.paper,
    color: active ? C.paper : C.cacao,
    fontFamily: FONT_MONO,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    cursor: "pointer",
    fontWeight: 700,
  };
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 2,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 10px",
          border: `1px solid ${C.sand}`,
          borderRadius: 8,
          background: C.paper,
          color: C.ink,
          fontFamily: FONT_UI,
          fontSize: 13,
          outline: "none",
        }}
      />
    </label>
  );
}

// ─── Date helpers para presets ──────────────────────────────────────────────
//
// Trabajamos en hora local del navegador. Los presets simples (today, 7d,
// 30d) van con `days` y dejan que el backend resuelva. Los relativos
// computan from/to localmente porque su definición ("este mes") depende
// del calendario del operador, no del servidor.

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDaysLocal(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildPresetRange(
  key: Exclude<RangePreset, "custom">,
): DateRange {
  const t = today();
  switch (key) {
    case "today":
      return { kind: "preset", preset: "today", days: 1 };
    case "7d":
      return { kind: "preset", preset: "7d", days: 7 };
    case "30d":
      return { kind: "preset", preset: "30d", days: 30 };
    case "yesterday": {
      const y = addDaysLocal(t, -1);
      return {
        kind: "preset",
        preset: "yesterday",
        from: isoDay(y),
        to: isoDay(y),
      };
    }
    case "this_month": {
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      return {
        kind: "preset",
        preset: "this_month",
        from: isoDay(start),
        to: isoDay(t),
      };
    }
    case "last_month": {
      const start = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      // Día 0 del mes actual = último día del mes anterior.
      const end = new Date(t.getFullYear(), t.getMonth(), 0);
      return {
        kind: "preset",
        preset: "last_month",
        from: isoDay(start),
        to: isoDay(end),
      };
    }
  }
}

// ─── KPI strip ──────────────────────────────────────────────────────────────
//
// 4 KPIs operativos del bar. Cada card muestra:
//   - Label (caption Manrope mono uppercase)
//   - Valor grande Bebas, color por tono semántico
//   - Delta vs período anterior (▲/▼ % con color verde/rojo)
//   - Sparkline mini (SVG nativo) basado en daily_breakdown
//
// "Ticket promedio" no tiene sparkline porque es un derivado (revenue /
// tickets) — graficar el cociente día a día introduce ruido en días con
// pocos tickets. Lo dejamos solo con delta.
//
// Sticky top: al hacer scroll por los gráficos y listas de abajo, los
// KPIs se quedan visibles arriba para no perder el contexto del período
// que estás analizando.
function SalesKpiStrip({
  summary,
  previous,
  daily,
  justRefreshed,
}: {
  summary: SalesInsightsResponse["summary"];
  previous: SalesInsightsResponse["previous_period"];
  daily: SalesInsightsResponse["daily_breakdown"];
  /** Se prende 1.2s después de un refresh por socket — pinta un dot
   *  pulsante para que el operador vea que el dashboard está vivo. */
  justRefreshed?: boolean;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        marginBottom: 16,
        marginInline: "-24px",
        paddingInline: 24,
        paddingBlock: 12,
        background: `linear-gradient(180deg, ${C.cream} 0%, color-mix(in srgb, ${C.cream} 92%, transparent) 100%)`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderBottom: `1px solid ${C.sand}`,
      }}
    >
      {/* Indicador "live" — aparece arriba a la derecha cuando se acaba
          de refrescar por socket. Dot dorado pulsante con la palabra
          "Actualizado". Se va solo después de 1.2s vía justRefreshed. */}
      <AnimatePresence>
        {justRefreshed && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: DUR_BASE / 1000, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: "absolute",
              top: 8,
              right: 24,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 999,
              background: `color-mix(in srgb, ${C.goldSoft} 60%, ${C.paper})`,
              border: `1px solid ${C.gold}`,
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 1.2,
              color: C.cacao,
              fontWeight: 800,
              textTransform: "uppercase",
              pointerEvents: "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: C.gold,
              }}
            />
            Actualizado
          </motion.div>
        )}
      </AnimatePresence>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <KpiCard
          index={0}
          label="Ingresos"
          value={fmt(summary.total_revenue)}
          tone="warm"
          previous={previous.total_revenue}
          current={summary.total_revenue}
          spark={daily.map((d) => d.revenue)}
          formatPrev={fmt}
        />
        <KpiCard
          index={1}
          label="Tickets"
          value={String(summary.tickets_count)}
          tone="success"
          previous={previous.tickets_count}
          current={summary.tickets_count}
          spark={daily.map((d) => d.tickets)}
        />
        <KpiCard
          index={2}
          label="Ticket promedio"
          value={summary.tickets_count > 0 ? fmt(summary.avg_ticket) : "—"}
          tone="neutral"
          previous={previous.avg_ticket}
          current={summary.avg_ticket}
          formatPrev={fmt}
        />
        <KpiCard
          index={3}
          label="Unidades"
          value={String(summary.total_units)}
          tone="neutral"
          previous={previous.total_units}
          current={summary.total_units}
          spark={daily.map((d) => d.units)}
        />
      </div>
    </div>
  );
}

type KpiTone = "neutral" | "success" | "warm" | "alert";

const TONE_COLOR: Record<KpiTone, string> = {
  neutral: C.cacao,
  success: C.olive,
  warm: C.gold,
  alert: C.terracotta,
};

function KpiCard({
  label,
  value,
  tone,
  current,
  previous,
  spark,
  formatPrev,
  index,
}: {
  label: string;
  value: string;
  tone: KpiTone;
  /** Valor numérico actual (para calcular delta vs anterior). */
  current: number;
  /** Valor numérico del período anterior. */
  previous: number;
  /** Serie de valores diarios para sparkline. Si null, no se dibuja. */
  spark?: number[];
  /** Cómo formatear el valor anterior en el tooltip — default: stringify. */
  formatPrev?: (n: number) => string;
  /** Índice en el strip — controla el delay del stagger de entrada. */
  index: number;
}) {
  const valueColor = TONE_COLOR[tone];
  const delta = computeDelta(current, previous);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DUR_SLOW / 1000,
        ease: [0.16, 1, 0.3, 1],
        delay: index * 0.05,
      }}
      style={{
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: C.shadow,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 2,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        {/* Cross-fade del valor cuando cambia (rango nuevo seleccionado).
            Key = value para que AnimatePresence detecte el swap. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: DUR_BASE / 1000, ease: [0.16, 1, 0.3, 1] }}
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 26,
              color: valueColor,
              letterSpacing: 0.5,
              lineHeight: 1,
              display: "inline-block",
            }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
        <DeltaBadge
          delta={delta}
          title={
            previous > 0
              ? `Período anterior: ${formatPrev ? formatPrev(previous) : previous}`
              : "Sin datos del período anterior"
          }
        />
      </div>
      {spark && spark.length > 1 && (
        <Sparkline values={spark} color={valueColor} />
      )}
    </motion.div>
  );
}

function DeltaBadge({
  delta,
  title,
}: {
  delta: { pct: number; sign: 1 | -1 | 0; finite: boolean };
  title?: string;
}) {
  if (!delta.finite) {
    return (
      <span
        title={title}
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 0.5,
          color: C.mute,
          fontWeight: 700,
          padding: "2px 6px",
          borderRadius: 999,
          background: C.parchment,
        }}
      >
        —
      </span>
    );
  }
  const isUp = delta.sign === 1;
  const isFlat = delta.sign === 0;
  const color = isFlat ? C.mute : isUp ? C.olive : C.terracotta;
  const bg = isFlat
    ? C.parchment
    : isUp
      ? `color-mix(in srgb, ${C.oliveSoft} 60%, ${C.paper})`
      : `color-mix(in srgb, ${C.terracottaSoft} 60%, ${C.paper})`;
  const arrow = isFlat ? "•" : isUp ? "▲" : "▼";
  return (
    <span
      title={title}
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 0.5,
        color,
        fontWeight: 800,
        padding: "2px 7px",
        borderRadius: 999,
        background: bg,
        whiteSpace: "nowrap",
      }}
    >
      {arrow} {Math.abs(Math.round(delta.pct))}%
    </span>
  );
}

/**
 * Sparkline SVG inline. Sin librería: para 7-30 puntos un SVG con un
 * `<path>` y un `<polyline>` rellenado por debajo es suficiente, más
 * customizable y ~50× más liviano que cargar recharts.
 *
 * Si todos los valores son cero la línea queda plana en el medio del
 * box (mejor que cero al fondo, que se confunde con border-bottom).
 */
function Sparkline({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const W = 100;
  const H = 28;
  const max = Math.max(...values, 0);
  const min = 0;
  const range = max - min || 1;
  const stepX = values.length > 1 ? W / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = i * stepX;
    // Si todo es 0, dejamos la línea en el medio (H/2) — visualmente
    // significa "plano" sin colapsar contra el borde inferior.
    const y =
      max === 0
        ? H / 2
        : H - ((v - min) / range) * (H - 4) - 2;
    return [x, y] as const;
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");
  const areaPath =
    `M 0 ${H} ` +
    points.map((p) => `L ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ") +
    ` L ${W} ${H} Z`;

  return (
    <svg
      role="img"
      aria-label="Tendencia del período"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{
        width: "100%",
        height: H,
        display: "block",
        overflow: "visible",
      }}
    >
      <path d={areaPath} fill={color} fillOpacity={0.12} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * % cambio vs período anterior. Si el anterior fue 0 y el actual no, no
 * podemos sacar % (división por cero) — devolvemos `finite: false` y el
 * badge muestra "—" en vez de "+∞%". Si ambos son 0 también es un caso
 * sin información útil.
 */
function computeDelta(
  current: number,
  previous: number,
): { pct: number; sign: 1 | -1 | 0; finite: boolean } {
  if (previous === 0) {
    return { pct: 0, sign: 0, finite: false };
  }
  const pct = ((current - previous) / previous) * 100;
  const sign = pct > 0.5 ? 1 : pct < -0.5 ? -1 : 0;
  return { pct, sign, finite: true };
}

// ─── Charts ─────────────────────────────────────────────────────────────────
//
// Tres gráficos hechos a mano con SVG. No traemos recharts/visx porque:
//   - Son bar charts simples sin interactividad rica.
//   - Cargar 80–120kb de lib para 3 charts no se justifica.
//   - SVG nativo es 100% customizable con la paleta del bar.
//
// Patrón común: viewBox dinámico, eje Y implícito (los números viven
// dentro del tooltip), eje X con etiquetas mínimas. Hover dispara un
// tooltip absoluto posicionado sobre la barra.

const CHART_BAR_GAP_RATIO = 0.18;

const WEEKDAY_LABELS_ES = ["D", "L", "M", "M", "J", "V", "S"] as const;
const WEEKDAY_LONG_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

function DailyRevenueChart({
  points,
}: {
  points: SalesInsightsResponse["daily_breakdown"];
}) {
  const max = Math.max(...points.map((p) => p.revenue), 0);
  // Cuántas etiquetas X mostramos para no saturar. Para 1d/7d todas;
  // para 30d cada 5 días aprox; para 90+ cada ~10.
  const labelStep =
    points.length <= 10
      ? 1
      : points.length <= 31
        ? Math.ceil(points.length / 7)
        : Math.ceil(points.length / 10);
  return (
    <BarChart
      values={points.map((p, i) => ({
        key: p.date,
        value: p.revenue,
        // Tono diferente para sábado (6) y domingo (0) — fines de semana
        // suelen ser distintos en bares, queremos que se vean.
        color:
          p.weekday === 0 || p.weekday === 6 ? C.terracotta : C.gold,
        label:
          i % labelStep === 0
            ? `${WEEKDAY_LABELS_ES[p.weekday]}${dayOfMonth(p.date)}`
            : "",
        tooltip: `${formatDayShort(p.date)} · ${fmt(p.revenue)} · ${p.units} u · ${p.tickets} tk`,
      }))}
      max={max}
    />
  );
}

function HourlyChart({
  points,
}: {
  points: SalesInsightsResponse["hourly_breakdown"];
}) {
  const [metric, setMetric] = useState<"revenue" | "units">("revenue");
  const max = Math.max(
    ...points.map((p) => (metric === "revenue" ? p.revenue : p.units)),
    0,
  );
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 10,
        }}
      >
        {(["revenue", "units"] as const).map((m) => {
          const active = metric === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className="crown-btn"
              aria-pressed={active}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${active ? C.ink : C.sand}`,
                background: active ? C.ink : C.paper,
                color: active ? C.paper : C.cacao,
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {m === "revenue" ? "Ingresos" : "Unidades"}
            </button>
          );
        })}
      </div>
      <BarChart
        values={points.map((p) => ({
          key: String(p.hour),
          value: metric === "revenue" ? p.revenue : p.units,
          color: C.cacao,
          // Etiqueta cada 3 horas: 0, 3, 6, ... — denso pero legible.
          label: p.hour % 3 === 0 ? formatHour(p.hour) : "",
          tooltip: `${formatHour(p.hour)} · ${
            metric === "revenue" ? fmt(p.revenue) : `${p.units} unidades`
          }`,
        }))}
        max={max}
      />
    </div>
  );
}

function WeekdayChart({
  points,
}: {
  points: SalesInsightsResponse["weekday_breakdown"];
}) {
  // Reordenamos: queremos lunes primero (ergonómico para humanos),
  // pero el backend usa convención JS (0=domingo).
  const reordered = [1, 2, 3, 4, 5, 6, 0].map((wd) =>
    points.find((p) => p.weekday === wd) ?? {
      weekday: wd,
      avg_units: 0,
      avg_revenue: 0,
      sample_count: 0,
    },
  );
  const max = Math.max(...reordered.map((p) => p.avg_revenue), 0);
  return (
    <BarChart
      values={reordered.map((p) => ({
        key: String(p.weekday),
        value: p.avg_revenue,
        color:
          p.weekday === 0 || p.weekday === 6 ? C.terracotta : C.gold,
        label: WEEKDAY_LONG_ES[p.weekday].slice(0, 3),
        tooltip:
          p.sample_count > 0
            ? `${WEEKDAY_LONG_ES[p.weekday]} · prom. ${fmt(p.avg_revenue)} · ${p.avg_units.toFixed(1)} u (${p.sample_count} ${p.sample_count === 1 ? "día" : "días"})`
            : `${WEEKDAY_LONG_ES[p.weekday]} · sin datos`,
      }))}
      max={max}
    />
  );
}

/**
 * BarChart genérico. Recibe arrays de `values` y un `max` global; cada
 * barra es un rect SVG con un overlay invisible más grande para captar
 * hover (el área hit es la columna completa, no solo la barra). El
 * tooltip se posiciona absoluto encima del SVG via state.
 */
type BarValue = {
  key: string;
  value: number;
  color: string;
  label: string;
  tooltip: string;
};

function BarChart({ values, max }: { values: BarValue[]; max: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Arquitectura del chart:
  //   - Barras: SVG con preserveAspectRatio="none" → estirar libre al ancho
  //     del contenedor. Los rects se deforman bien (no perdemos info).
  //   - Labels eje X: HTML normal abajo del SVG, así respetan tipografía
  //     real y no se estiran. Solucionan el problema de texto borroso.
  //   - Hit area: HTML overlay encima del SVG, captura hover preciso por
  //     columna sin depender del SVG (más fácil de mantener).
  //   - Tooltip: HTML absoluto, posicionado por porcentaje del slot.
  const W = 100;
  const chartH = 130; // SVG interno solo (sin labels)
  const slotW = values.length > 0 ? W / values.length : 0;
  const barW = slotW * (1 - CHART_BAR_GAP_RATIO);
  const barOffset = (slotW - barW) / 2;
  const slotPct = values.length > 0 ? 100 / values.length : 0;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "relative", height: chartH }}>
        <svg
          viewBox={`0 0 ${W} ${chartH}`}
          preserveAspectRatio="none"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            overflow: "visible",
          }}
        >
          {/* Línea base */}
          <line
            x1={0}
            x2={W}
            y1={chartH}
            y2={chartH}
            stroke={C.sand}
            strokeWidth={0.4}
            vectorEffect="non-scaling-stroke"
          />
          {values.map((v, i) => {
            const h = max > 0 ? (v.value / max) * (chartH - 2) : 0;
            const x = i * slotW + barOffset;
            const y = chartH - h;
            const isHover = hoverIdx === i;
            // Stagger limitado: con 30 barras un delay de 25ms haría 750ms
            // total. Capamos a 12ms para que cierre en < 0.5s aun con muchas.
            const delay = Math.min(i * 0.012, 0.4);
            return (
              <motion.rect
                key={v.key}
                initial={{ y: chartH, height: 0, opacity: 0 }}
                animate={{
                  y,
                  height: Math.max(h, max > 0 && v.value > 0 ? 0.5 : 0),
                  opacity: isHover ? 1 : 0.85,
                }}
                transition={{
                  duration: DUR_SLOW / 1000,
                  ease: [0.16, 1, 0.3, 1],
                  delay,
                }}
                x={x}
                width={barW}
                fill={v.color}
              />
            );
          })}
        </svg>
        {/* Hit areas en HTML — un overlay por columna, ocupa el slot
            completo (no solo la barra) para que el hover funcione aun en
            barras de altura cero o muy chicas. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
          }}
        >
          {values.map((v, i) => (
            <div
              key={v.key}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              title={v.tooltip}
              style={{
                flex: 1,
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      </div>

      {/* Strip de etiquetas X en HTML. Tipografía respetada, no se
          deforma al estirar el contenedor. Cada label ocupa el ancho de
          su slot — alineación matemática con las barras por flex 1. */}
      <div
        style={{
          display: "flex",
          marginTop: 6,
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 0.5,
          color: C.mute,
          fontWeight: 700,
          textTransform: "uppercase",
        }}
        aria-hidden
      >
        {values.map((v) => (
          <div
            key={v.key}
            style={{
              flex: 1,
              textAlign: "center",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {v.label}
          </div>
        ))}
      </div>

      {/* Tooltip flotante posicionado por porcentaje del slot. */}
      {hoverIdx != null && values[hoverIdx] && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: 0,
            left: `${(hoverIdx + 0.5) * slotPct}%`,
            transform: "translate(-50%, calc(-100% - 6px))",
            background: C.ink,
            color: C.paper,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 0.3,
            fontWeight: 700,
            padding: "6px 10px",
            borderRadius: 8,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 4px 12px -4px rgba(43,29,20,0.4)",
            zIndex: 4,
          }}
        >
          {values[hoverIdx].tooltip}
        </div>
      )}
    </div>
  );
}

function dayOfMonth(iso: string): string {
  // iso = YYYY-MM-DD → "12"
  return iso.slice(8, 10);
}

function formatDayShort(iso: string): string {
  // iso = YYYY-MM-DD → "Sáb 12 abr"
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}h`;
}

// ─── Restock hero ───────────────────────────────────────────────────────────
//
// Único panel accionable de la página. Se renderiza solo cuando hay
// productos críticos — si todo está OK lo escondemos para no agregar
// ruido. El click en cada fila lleva a /admin/products?id=X donde el
// operador puede registrar el movimiento de stock con su panel ya
// existente (Paso 5 del rediseño de productos).
//
// Diseño: borde terracotta 2px (vs 1px de los paneles normales) +
// fondo tinte muy suave del color de alerta + icono ⚠️ para que se
// note de un vistazo sin necesidad de leer el título.
function RestockHero({
  items,
}: {
  items: SalesInsightsResponse["low_stock_high_demand"];
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: DUR_SLOW / 1000, ease: [0.16, 1, 0.3, 1] }}
      style={{
        marginBottom: 16,
        background: `linear-gradient(180deg, color-mix(in srgb, ${C.terracottaSoft} 35%, ${C.paper}) 0%, ${C.paper} 100%)`,
        border: `2px solid ${C.terracotta}`,
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: C.shadow,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 999,
            background: C.terracotta,
            color: C.paper,
            fontFamily: FONT_DISPLAY,
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          !
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 3,
              color: C.terracotta,
              fontWeight: 700,
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            — Acción requerida
          </div>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 18,
              letterSpacing: 1.5,
              color: C.ink,
              textTransform: "uppercase",
              margin: 0,
              lineHeight: 1,
            }}
          >
            Reponer pronto
          </h2>
        </div>
        <span
          style={{
            padding: "4px 12px",
            borderRadius: 999,
            background: C.terracotta,
            color: C.paper,
            fontFamily: FONT_MONO,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.5,
          }}
        >
          {items.length}
        </span>
      </header>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {items.map((p, i) => (
          <motion.li
            key={p.product_id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: DUR_BASE / 1000,
              ease: [0.16, 1, 0.3, 1],
              delay: 0.1 + i * 0.04,
            }}
            style={{
              background: C.paper,
              border: `1px solid ${C.sand}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <ProductLink productId={p.product_id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 16,
                    color: C.ink,
                    letterSpacing: 0.5,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 1.2,
                    color: C.mute,
                    textTransform: "uppercase",
                    marginTop: 2,
                    fontWeight: 600,
                  }}
                >
                  {p.category} · vendidos {p.units_sold} · stock{" "}
                  <strong style={{ color: C.terracotta, fontWeight: 800 }}>
                    {p.stock}
                  </strong>
                  {p.low_stock_threshold > 0 && (
                    <> / umbral {p.low_stock_threshold}</>
                  )}
                </div>
              </div>
              <span
                aria-hidden
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  color: C.cacao,
                  letterSpacing: 0.5,
                  flexShrink: 0,
                }}
              >
                →
              </span>
            </ProductLink>
          </motion.li>
        ))}
      </ul>
    </motion.section>
  );
}

// ─── Drill-down a producto ──────────────────────────────────────────────────
//
// Wrapper clickable que envuelve el contenido de cada fila de las listas
// y la lleva al panel de detalle de productos con el id seleccionado.
// El panel derecho de productos abre en modo "view" — desde ahí el
// operador puede registrar movimiento, editar, etc., sin duplicar lógica.
function ProductLink({
  productId,
  children,
}: {
  productId: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/admin/products?id=${productId}`}
      className="crown-btn"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 12px",
        textDecoration: "none",
        color: C.ink,
        background: "transparent",
        borderRadius: 8,
        border: "none",
        transition: "background 160ms cubic-bezier(0.16,1,0.3,1)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = C.parchment;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </Link>
  );
}

// ─── Categorías ─────────────────────────────────────────────────────────────
//
// Lista de categorías con barra horizontal proporcional al revenue de
// la categoría top. Da feedback visual instantáneo de qué categorías
// representan más del negocio sin necesidad de un donut chart (que
// requeriría segmentar arcos y leyendas — mucho más código para info
// equivalente).
function CategoryList({
  rows,
}: {
  rows: SalesInsightsResponse["revenue_by_category"];
}) {
  const max = rows.length > 0 ? rows[0].revenue : 0;
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {rows.map((r, i) => {
        const pct = max > 0 ? (r.revenue / max) * 100 : 0;
        // Stagger limitado a ~150ms total — con muchas categorías
        // no queremos que las últimas tarden medio segundo en aparecer.
        const delay = Math.min(i * 0.04, 0.32);
        return (
          <motion.li
            key={r.category}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: DUR_BASE / 1000,
              ease: [0.16, 1, 0.3, 1],
              delay,
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: C.parchment,
              border: `1px solid ${C.sand}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  color: C.ink,
                  letterSpacing: 0.3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textTransform: "uppercase",
                }}
              >
                {r.category}
              </span>
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 14,
                  color: C.gold,
                  letterSpacing: 0.3,
                  whiteSpace: "nowrap",
                }}
              >
                {fmt(r.revenue)}
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: 5,
                background: C.sand,
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{
                  duration: DUR_SLOW / 1000,
                  ease: [0.16, 1, 0.3, 1],
                  delay: delay + 0.1,
                }}
                style={{
                  height: "100%",
                  background: `linear-gradient(90deg, ${C.gold} 0%, ${C.terracotta} 100%)`,
                }}
              />
            </div>
            <div
              style={{
                marginTop: 3,
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1.5,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {r.units} {r.units === 1 ? "unidad" : "unidades"}
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR_SLOW / 1000, ease: [0.16, 1, 0.3, 1] }}
      style={{
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <h2
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          color: C.ink,
          letterSpacing: 3,
          textTransform: "uppercase",
          margin: "0 0 12px",
        }}
      >
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

function ProductTable({
  rows,
  mode,
}: {
  rows: ProductSalesSummary[];
  mode: "units" | "revenue";
}) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {rows.map((p, i) => (
        <li
          key={p.product_id}
          style={{
            borderBottom:
              i === rows.length - 1 ? "none" : `1px solid ${C.sand}`,
          }}
        >
          <Link
            href={`/admin/products?id=${p.product_id}`}
            className="crown-btn"
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 10,
              alignItems: "center",
              padding: "10px 8px",
              textDecoration: "none",
              color: C.ink,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              transition: "background 160ms cubic-bezier(0.16,1,0.3,1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = C.parchment;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 16,
                color: C.mute,
                width: 26,
                textAlign: "right",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 16,
                  color: C.ink,
                  letterSpacing: 0.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 1.5,
                  color: C.mute,
                  textTransform: "uppercase",
                }}
              >
                {p.category}
              </div>
            </div>
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 18,
                color: mode === "units" ? C.olive : C.gold,
                letterSpacing: 0.5,
                whiteSpace: "nowrap",
              }}
            >
              {mode === "units" ? `${p.units_sold} u` : fmt(p.revenue)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 18,
        textAlign: "center",
        fontFamily: FONT_MONO,
        fontSize: 11,
        color: C.mute,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  );
}

// Convierte el DateRange compartido en params para las APIs nuevas.
// DRY: el bloque ya existe inline en `refresh()`; ambos tabs lo reusan.
function rangeToParams(range: DateRange): {
  from?: string;
  to?: string;
  days?: number;
} {
  if (range.kind === "custom") {
    return { from: range.from, to: range.to };
  }
  if (range.from && range.to) {
    return { from: range.from, to: range.to };
  }
  return { days: range.days };
}

// ─── Tab "Detalle" ──────────────────────────────────────────────────────────
// Cuentas cerradas en el rango. Lista clickeable (cada fila expande para
// ver el detalle de líneas — productos, descuentos, refunds, pagos
// parciales). Pagadas y anuladas comparten lista; las anuladas llevan
// badge "Anulada" + razón.
function DetailTab({
  range,
  liveTick,
}: {
  range: DateRange;
  liveTick: boolean;
}) {
  const [data, setData] = useState<ClosedSessionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await salesInsightsApi.getClosedSessions(rangeToParams(range));
      setData(res);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresco oportunista cuando el padre detecta un cambio (delivery,
  // refund, cierre). `liveTick` se prende ~1s tras un evento de socket.
  useEffect(() => {
    if (liveTick) void load();
  }, [liveTick, load]);

  const toggleExpand = (sessionId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  if (loading && !data) return <LoadingBlock />;
  if (error) return <ErrorBlock text={error} />;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPIs del tab: resumen de paid vs void. Más liviano que el strip
          del Resumen — acá el foco es la lista de cuentas. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        <MiniStat
          label="Cuentas cerradas"
          value={String(data.total)}
          hint={`${data.paid_count} pagadas · ${data.void_count} anuladas`}
        />
        <MiniStat label="Ingresos cobrados" value={fmt(data.paid_revenue)} />
        <MiniStat
          label="Anulado (perdido)"
          value={fmt(data.void_lost_revenue)}
          tone={data.void_lost_revenue > 0 ? "alert" : "neutral"}
        />
      </div>

      {data.sessions.length === 0 ? (
        <Panel title="Sin cuentas cerradas">
          <Empty text="No hubo cierres en este rango" />
        </Panel>
      ) : (
        <Panel title={`Detalle (${data.sessions.length})`}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            <AnimatePresence initial={false}>
              {data.sessions.map((s) => (
                <ClosedSessionRow
                  key={s.session_id}
                  session={s}
                  expanded={expanded.has(s.session_id)}
                  onToggle={() => toggleExpand(s.session_id)}
                />
              ))}
            </AnimatePresence>
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ClosedSessionRow({
  session,
  expanded,
  onToggle,
}: {
  session: ClosedSessionApi;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tableLabel =
    session.table_kind === "BAR"
      ? `Barra ${session.table_number ?? session.table_id}`
      : `Mesa ${session.table_number ?? session.table_id}`;
  const closedAt = session.closed_at ? new Date(session.closed_at) : null;
  const openedAt = new Date(session.opened_at);
  const isVoid = session.outcome === "void";

  return (
    <li
      style={{
        borderBottom: `1px solid ${C.sand}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 0",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          color: C.ink,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.mute,
              letterSpacing: 1.5,
              fontWeight: 700,
              minWidth: 12,
            }}
          >
            {expanded ? "▾" : "▸"}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 16,
                  color: C.ink,
                  letterSpacing: 0.5,
                }}
              >
                {tableLabel}
              </span>
              {session.custom_name && (
                <span
                  style={{
                    fontFamily: FONT_UI,
                    fontSize: 12,
                    color: C.mute,
                  }}
                >
                  · {session.custom_name}
                </span>
              )}
              {isVoid && (
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 9,
                    color: C.terracotta,
                    background: C.terracottaSoft,
                    padding: "2px 6px",
                    borderRadius: 999,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Anulada · {session.void_reason ?? "sin razón"}
                </span>
              )}
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.mute,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              {formatHm(openedAt)}
              {closedAt && ` → ${formatHm(closedAt)}`} · {session.lines.length} líneas
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 18,
              color: isVoid ? C.mute : C.gold,
              letterSpacing: 0.5,
              textDecoration: isVoid ? "line-through" : "none",
            }}
          >
            {fmt(session.collected)}
          </div>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DUR_BASE / 1000, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            <ClosedSessionDetail session={session} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ClosedSessionDetail({ session }: { session: ClosedSessionApi }) {
  return <ThermalReceipt session={session} />;
}

// ─── Thermal receipt ────────────────────────────────────────────────────
// Look de ticket de impresora térmica: monoespaciado, ancho fijo, bordes
// dentados arriba y abajo (zig-zag CSS). Mantiene la paleta del bar
// (cream/cacao/gold) en vez del clásico blanco-y-negro para no romper
// con el resto de la página.

const RECEIPT_WIDTH_CH = 38; // ancho típico de impresora 80mm en chars

/**
 * Agrupa líneas de producto por `description`. Se respeta el orden de
 * aparición del primer match. Refunds, descuentos, ajustes y pagos
 * parciales NUNCA se agrupan: son ledger events distintos y merecen su
 * propia línea con el monto exacto.
 *
 * `units` se concatena para que, cuando hay composiciones diferentes en
 * un mismo producto, el operador pueda desplegar "ver composición" y ver
 * cada unidad por separado.
 */
type GroupedLine = {
  description: string;
  quantity: number;
  amount: number;
  type: ClosedSessionLineApi["type"];
  /** Composiciones acumuladas de todas las unidades vendidas bajo este grupo. */
  units: ClosedSessionLineUnitApi[];
  /** True si en el grupo hay al menos una unidad con composición. */
  hasComposition: boolean;
};

function groupLines(lines: ClosedSessionLineApi[]): GroupedLine[] {
  const productGroups = new Map<string, GroupedLine>();
  const orderedKeys: string[] = [];
  const nonProduct: GroupedLine[] = [];

  for (const l of lines) {
    if (l.type !== "product") {
      // Ajustes/refunds/descuentos/parciales van tal cual, en su lugar.
      nonProduct.push({
        description: l.description,
        quantity: l.quantity,
        amount: l.amount,
        type: l.type,
        units: [],
        hasComposition: false,
      });
      continue;
    }
    const existing = productGroups.get(l.description);
    if (existing) {
      existing.quantity += l.quantity;
      existing.amount += l.amount;
      // Renumeramos unit_index para que el desplegable enumere "Unidad 1,
      // Unidad 2..." globalmente y no repita índices entre líneas.
      for (const u of l.units) {
        existing.units.push({
          unit_index: existing.units.length,
          components: u.components,
        });
      }
      if (l.units.length > 0) existing.hasComposition = true;
    } else {
      const renumbered = l.units.map((u, i) => ({
        unit_index: i,
        components: u.components,
      }));
      productGroups.set(l.description, {
        description: l.description,
        quantity: l.quantity,
        amount: l.amount,
        type: "product",
        units: renumbered,
        hasComposition: l.units.length > 0,
      });
      orderedKeys.push(l.description);
    }
  }

  const productLines = orderedKeys.map((k) => productGroups.get(k)!);
  return [...productLines, ...nonProduct];
}

function ThermalReceipt({ session }: { session: ClosedSessionApi }) {
  const grouped = groupLines(session.lines);
  const tableLabel =
    session.table_kind === "BAR"
      ? `BARRA ${session.table_number ?? session.table_id}`
      : `MESA ${session.table_number ?? session.table_id}`;
  const openedAt = new Date(session.opened_at);
  const closedAt = session.closed_at ? new Date(session.closed_at) : null;
  // Mostramos la línea de descuentos/refunds solo si afectaron lo cobrado
  // (ajustes reales sobre productos). Los refunds de partial_payment ya
  // están reclasificados como partials en el backend, así que aquí
  // adjustments_total refleja únicamente descuentos/refunds genuinos.
  const showAdjustments = session.adjustments_total !== 0;
  // Anticipos: cuando los hubo, mostramos "Anticipos cobrados" y
  // "Pagado al cierre" como info, no como restas al total.
  const hadPartialPayments = session.partial_payments_total !== 0;
  // partial_payments_total ya es negativo en la BD. Lo invertimos para
  // mostrarlo en positivo ("cobrado $19.000 por adelantado").
  const partialsCollected = Math.abs(session.partial_payments_total);
  // Lo cobrado al cierre = collected − anticipos netos (en valor absoluto
  // de los partials, ya que partial es negativo).
  const paidAtClose = session.collected - partialsCollected;

  return (
    <div
      style={{
        margin: "0 auto 12px",
        maxWidth: 360,
        padding: "0 6px",
      }}
    >
      <div
        style={{
          background: "#FFFDF8",
          color: "#2B1D14",
          padding: "18px 16px 22px",
          // Sombra sutil + bordes dentados arriba y abajo (zig-zag CSS).
          // `mask` corta el div en triángulos; la inversa lo aplica a una
          // versión del fondo. Soportado en navegadores modernos.
          boxShadow:
            "0 1px 0 rgba(43,29,20,0.05), 0 8px 24px -10px rgba(43,29,20,0.18)",
          // Bordes dentados: usamos `mask` para cortar zigzag arriba/abajo.
          maskImage:
            "linear-gradient(to bottom, transparent 0, transparent 6px, #000 6px, #000 calc(100% - 6px), transparent calc(100% - 6px)), radial-gradient(circle at 6px 6px, transparent 6px, #000 6px)",
          // Tipografía monoespaciada (system mono — sin necesidad de
          // cargar fuente extra). Las medidas exactas garantizan la
          // alineación columna-derecha de los precios.
          fontFamily:
            "ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Mono', Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          letterSpacing: 0,
          whiteSpace: "pre-wrap",
          position: "relative",
        }}
      >
        {/* Zig-zag arriba */}
        <ReceiptTearEdge position="top" />

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <div
            style={{
              fontFamily: "var(--font-blackletter), serif",
              fontSize: 22,
              letterSpacing: 1,
              fontWeight: 700,
              color: "#2B1D14",
              marginBottom: 2,
            }}
          >
            Crown Bar 4.90
          </div>
          <div style={{ fontSize: 10, color: "#6B4E2E" }}>
            Pub futbolero · Cafetería
          </div>
        </div>

        <ReceiptDivider />

        {/* Metadata */}
        <ReceiptRow left={tableLabel} right={`#${session.session_id}`} bold />
        {session.custom_name && (
          <ReceiptRow left="Nombre" right={session.custom_name} />
        )}
        <ReceiptRow left="Apertura" right={formatDateTime(openedAt)} />
        {closedAt && (
          <ReceiptRow left="Cierre" right={formatDateTime(closedAt)} />
        )}
        <ReceiptRow
          left="Estado"
          right={session.outcome === "void" ? "ANULADA" : "PAGADA"}
          tone={session.outcome === "void" ? "alert" : "ok"}
        />
        {session.outcome === "void" && (
          <ReceiptRow left="Razón" right={session.void_reason ?? "—"} />
        )}

        <ReceiptDivider />

        {/* Líneas agrupadas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {grouped.map((g, idx) => (
            <ReceiptLine key={`${g.description}-${idx}`} group={g} />
          ))}
        </div>

        <ReceiptDivider />

        {/* Totales */}
        <ReceiptRow left="Subtotal" right={fmt(session.subtotal)} />
        {showAdjustments && (
          <ReceiptRow
            left={session.adjustments_total < 0 ? "Descuentos" : "Ajustes"}
            right={fmt(session.adjustments_total)}
            tone="alert"
          />
        )}
        {hadPartialPayments && (
          <>
            <ReceiptDivider thin />
            <ReceiptRow
              left="Anticipos cobrados"
              right={fmt(partialsCollected)}
              tone="muted"
            />
            <ReceiptRow
              left="Pagado al cierre"
              right={fmt(paidAtClose)}
              tone="muted"
            />
          </>
        )}
        <ReceiptDivider thin />
        <ReceiptRow
          left="TOTAL COBRADO"
          right={fmt(session.collected)}
          bold
          big
          strikethrough={session.outcome === "void"}
        />

        {session.outcome === "void" && session.void_other_detail && (
          <>
            <ReceiptDivider thin />
            <div
              style={{
                fontSize: 10,
                color: "#8B2635",
                textAlign: "center",
                marginTop: 6,
              }}
            >
              {session.void_other_detail}
            </div>
          </>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: 12,
            fontSize: 10,
            color: "#6B4E2E",
          }}
        >
          ¡Gracias por la visita!
        </div>

        {/* Zig-zag abajo */}
        <ReceiptTearEdge position="bottom" />
      </div>
    </div>
  );
}

function ReceiptLine({ group }: { group: GroupedLine }) {
  const [open, setOpen] = useState(false);
  const tone =
    group.type === "refund" || group.type === "discount"
      ? "alert"
      : group.type === "partial_payment"
        ? "muted"
        : "default";
  const canExpand = group.hasComposition && group.units.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={canExpand ? () => setOpen((v) => !v) : undefined}
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 6,
          padding: 0,
          background: "transparent",
          border: "none",
          font: "inherit",
          color: "inherit",
          cursor: canExpand ? "pointer" : "default",
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700 }}>
            {group.quantity > 1 ? `${group.quantity}×` : "1×"}
          </span>{" "}
          {group.description}
          {canExpand && (
            <span
              aria-hidden
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: "#6B4E2E",
              }}
            >
              {open ? "▾ ocultar" : "▸ ver composición"}
            </span>
          )}
        </span>
        <span
          style={{
            whiteSpace: "nowrap",
            fontWeight: tone === "default" ? 600 : 500,
            color:
              tone === "alert"
                ? "#8B2635"
                : tone === "muted"
                  ? "#6B4E2E"
                  : "#2B1D14",
          }}
        >
          {fmt(group.amount)}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && canExpand && (
          <motion.div
            key="comp"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DUR_BASE / 1000 }}
            style={{ overflow: "hidden" }}
          >
            <ul
              style={{
                margin: "4px 0 6px",
                padding: "4px 0 4px 16px",
                listStyle: "none",
                borderLeft: "2px dotted #B8894A",
                fontSize: 11,
                color: "#6B4E2E",
              }}
            >
              {group.units.map((u) => (
                <li key={u.unit_index} style={{ marginBottom: 2 }}>
                  Unidad {u.unit_index + 1}:{" "}
                  {u.components
                    .map((c) => `${c.quantity} ${c.name}`)
                    .join(" + ")}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReceiptRow({
  left,
  right,
  bold,
  big,
  tone,
  strikethrough,
}: {
  left: string;
  right: string;
  bold?: boolean;
  big?: boolean;
  tone?: "ok" | "alert" | "muted";
  strikethrough?: boolean;
}) {
  const color =
    tone === "alert"
      ? "#8B2635"
      : tone === "ok"
        ? "#5C7A3A"
        : tone === "muted"
          ? "#6B4E2E"
          : "#2B1D14";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 8,
        fontSize: big ? 15 : 12,
        fontWeight: bold ? 700 : 400,
        color,
        textDecoration: strikethrough ? "line-through" : "none",
      }}
    >
      <span>{left}</span>
      <span style={{ whiteSpace: "nowrap" }}>{right}</span>
    </div>
  );
}

function ReceiptDivider({ thin = false }: { thin?: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        margin: thin ? "4px 0" : "8px 0",
        borderTop: thin ? "1px dotted #B8894A" : "1px dashed #6B4E2E",
        opacity: thin ? 0.5 : 0.7,
      }}
    />
  );
}

function ReceiptTearEdge({ position }: { position: "top" | "bottom" }) {
  // Borde dentado clásico de ticket. Usamos un linear-gradient repetido
  // para dibujar triángulos, posicionado absolutamente justo afuera del
  // padding del recibo.
  const common: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    height: 8,
    backgroundImage:
      "linear-gradient(-45deg, #FFFDF8 4px, transparent 0), linear-gradient(45deg, #FFFDF8 4px, transparent 0)",
    backgroundPosition: "left bottom",
    backgroundSize: "8px 8px",
    backgroundRepeat: "repeat-x",
    pointerEvents: "none",
  };
  if (position === "top") {
    return (
      <div
        aria-hidden
        style={{
          ...common,
          top: -7,
          transform: "rotate(180deg)",
        }}
      />
    );
  }
  return <div aria-hidden style={{ ...common, bottom: -7 }} />;
}

function formatDateTime(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${h}:${m}`;
}

function MiniStat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "alert";
}) {
  return (
    <div
      style={{
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 12,
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 2,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 20,
          color: tone === "alert" ? C.terracotta : C.ink,
          letterSpacing: 0.5,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.mute,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            marginTop: 3,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div
      style={{
        padding: 32,
        textAlign: "center",
        fontFamily: FONT_MONO,
        fontSize: 11,
        color: C.mute,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      Cargando...
    </div>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: 10,
        borderRadius: 8,
        background: C.terracottaSoft,
        color: C.terracotta,
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  );
}

function formatHm(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// ─── Tab "Productos" ─────────────────────────────────────────────────────────
// Catálogo completo con métricas en el rango. Buscador (nombre/categoría),
// orden por columna clickeable, paginado server-side. Sin filtro de
// categoría — el operador lo pidió así.
type ProductSort = "revenue" | "units" | "name" | "category";
type SortDir = "asc" | "desc";

function ProductsTab({
  range,
  liveTick,
}: {
  range: DateRange;
  liveTick: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<ProductSort>("revenue");
  const [direction, setDirection] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [data, setData] = useState<ProductMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce del buscador para no martillear el backend con cada tecla.
  // 250ms es el dulce: rápido para sentirse responsive, suficiente para
  // que una palabra completa entre como una sola query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset paginación al cambiar filtros — si estabas en página 7 y
  // buscás "águ", quedarte en la 7 sería confuso.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sort, direction, range, includeInactive]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await salesInsightsApi.getAllProducts({
        ...rangeToParams(range),
        search: debouncedSearch || undefined,
        sort,
        direction,
        page,
        page_size: pageSize,
        include_inactive: includeInactive,
      });
      setData(res);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [range, debouncedSearch, sort, direction, page, pageSize, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (liveTick) void load();
  }, [liveTick, load]);

  const onHeader = (col: ProductSort) => {
    if (sort === col) {
      setDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(col);
      setDirection(col === "name" || col === "category" ? "asc" : "desc");
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Toolbar: buscador + toggle inactivos. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o categoría..."
          aria-label="Buscar producto"
          style={{
            flex: 1,
            minWidth: 200,
            padding: "10px 12px",
            border: `1px solid ${C.sand}`,
            borderRadius: 10,
            background: C.paper,
            color: C.ink,
            fontFamily: FONT_UI,
            fontSize: 13,
            outline: "none",
          }}
        />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.cacao,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Ver inactivos
        </label>
      </div>

      {/* KPI strip mini: totales del rango (independientes del paginado). */}
      {data && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
          }}
        >
          <MiniStat
            label="Productos visibles"
            value={String(data.total)}
            hint={`Página ${data.page} de ${totalPages}`}
          />
          <MiniStat label="Ingresos del rango" value={fmt(data.total_revenue)} />
          <MiniStat
            label="Unidades vendidas"
            value={String(data.total_units)}
          />
        </div>
      )}

      {error && <ErrorBlock text={error} />}
      {loading && !data && <LoadingBlock />}

      {data && (
        <Panel title="Catálogo">
          {data.rows.length === 0 ? (
            <Empty text="Sin resultados" />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: FONT_UI,
                  fontSize: 13,
                  color: C.ink,
                }}
              >
                <thead>
                  <tr>
                    <SortableTh
                      label="Producto"
                      col="name"
                      sort={sort}
                      direction={direction}
                      onClick={onHeader}
                      align="left"
                    />
                    <SortableTh
                      label="Categoría"
                      col="category"
                      sort={sort}
                      direction={direction}
                      onClick={onHeader}
                      align="left"
                    />
                    <SortableTh
                      label="Unidades"
                      col="units"
                      sort={sort}
                      direction={direction}
                      onClick={onHeader}
                      align="right"
                    />
                    <SortableTh
                      label="Ingresos"
                      col="revenue"
                      sort={sort}
                      direction={direction}
                      onClick={onHeader}
                      align="right"
                    />
                    <th
                      style={{
                        ...thBase(),
                        textAlign: "right",
                      }}
                    >
                      Tkt prom
                    </th>
                    <th
                      style={{
                        ...thBase(),
                        textAlign: "right",
                      }}
                    >
                      % total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <ProductRow key={r.product_id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación. */}
          {data.total > data.page_size && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: C.mute,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                }}
              >
                Viendo {(data.page - 1) * data.page_size + 1}–
                {Math.min(data.page * data.page_size, data.total)} de {data.total}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={pagerBtn(data.page <= 1)}
                >
                  ← Anterior
                </button>
                <button
                  type="button"
                  disabled={data.page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  style={pagerBtn(data.page >= totalPages)}
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function SortableTh({
  label,
  col,
  sort,
  direction,
  onClick,
  align,
}: {
  label: string;
  col: ProductSort;
  sort: ProductSort;
  direction: SortDir;
  onClick: (c: ProductSort) => void;
  align: "left" | "right";
}) {
  const active = sort === col;
  return (
    <th
      onClick={() => onClick(col)}
      style={{
        ...thBase(),
        textAlign: align,
        cursor: "pointer",
        userSelect: "none",
        color: active ? C.ink : C.mute,
      }}
    >
      {label}
      {active && (
        <span style={{ marginLeft: 4, fontFamily: FONT_MONO }}>
          {direction === "desc" ? "▼" : "▲"}
        </span>
      )}
    </th>
  );
}

function thBase(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderBottom: `1px solid ${C.sand}`,
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 1.8,
    color: C.mute,
    textTransform: "uppercase",
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
}

function ProductRow({ row }: { row: ProductMetricsRowApi }) {
  return (
    <tr
      style={{
        borderBottom: `1px solid ${C.sand}`,
        opacity: row.is_active ? 1 : 0.55,
      }}
    >
      <td style={{ padding: "8px 10px" }}>
        <ProductLink productId={row.product_id}>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 15,
              color: C.ink,
              letterSpacing: 0.3,
            }}
          >
            {row.name}
          </span>
          {!row.is_active && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                color: C.mute,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                marginLeft: 6,
              }}
            >
              · inactivo
            </span>
          )}
        </ProductLink>
      </td>
      <td
        style={{
          padding: "8px 10px",
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: C.cacao,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {row.category}
      </td>
      <td
        style={{
          padding: "8px 10px",
          textAlign: "right",
          fontFamily: FONT_UI,
          color: row.units_sold > 0 ? C.ink : C.mute,
        }}
      >
        {row.units_sold}
      </td>
      <td
        style={{
          padding: "8px 10px",
          textAlign: "right",
          fontFamily: FONT_UI,
          color: row.revenue > 0 ? C.gold : C.mute,
          fontWeight: 600,
        }}
      >
        {fmt(row.revenue)}
      </td>
      <td
        style={{
          padding: "8px 10px",
          textAlign: "right",
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: C.cacao,
        }}
      >
        {row.avg_ticket > 0 ? fmt(row.avg_ticket) : "—"}
      </td>
      <td
        style={{
          padding: "8px 10px",
          textAlign: "right",
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: row.revenue_pct > 0 ? C.cacao : C.mute,
        }}
      >
        {row.revenue_pct > 0 ? `${row.revenue_pct.toFixed(1)}%` : "—"}
      </td>
    </tr>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    border: `1px solid ${disabled ? C.sand : C.cacao}`,
    background: disabled ? C.cream : C.paper,
    color: disabled ? C.mute : C.ink,
    fontFamily: FONT_MONO,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: 700,
    borderRadius: 999,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
