"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  salesInsightsApi,
  type ProductSalesSummary,
  type SalesInsightsResponse,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
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

export default function AdminSalesPage() {
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [data, setData] = useState<SalesInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      {data && (
        <>
          <SalesKpiStrip
            summary={data.summary}
            previous={data.previous_period}
            daily={data.daily_breakdown}
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
    </main>
    </>
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
}: {
  summary: SalesInsightsResponse["summary"];
  previous: SalesInsightsResponse["previous_period"];
  daily: SalesInsightsResponse["daily_breakdown"];
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

const CHART_HEIGHT = 160;
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
  const W = 100;
  const H = CHART_HEIGHT;
  const labelStripH = 16;
  const chartH = H - labelStripH;
  const slotW = values.length > 0 ? W / values.length : 0;
  const barW = slotW * (1 - CHART_BAR_GAP_RATIO);
  const barOffset = (slotW - barW) / 2;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: H,
          display: "block",
          overflow: "visible",
        }}
      >
        {/* Línea base sutil sobre el strip de labels */}
        <line
          x1={0}
          x2={W}
          y1={chartH}
          y2={chartH}
          stroke={C.sand}
          strokeWidth={0.4}
        />
        {values.map((v, i) => {
          const h = max > 0 ? (v.value / max) * (chartH - 2) : 0;
          const x = i * slotW + barOffset;
          const y = chartH - h;
          const isHover = hoverIdx === i;
          // Stagger limitado: con 30 barras un delay de 25ms haría 750ms
          // total (lento). Capamos a 12ms para que la animación complete
          // bajo medio segundo incluso con muchos puntos.
          const delay = Math.min(i * 0.012, 0.4);
          return (
            <g key={v.key}>
              {/* Barra real con animación de crecimiento desde la base.
                  Animamos el `y` y el `height` (no scaleY) para que el
                  origen quede pegado al baseline sin transform-origin
                  jugando contra el viewBox. */}
              <motion.rect
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
              {/* Hit area transparente (slot completo) para capturar
                  hover/touch incluso en barras de altura cero. */}
              <rect
                x={i * slotW}
                y={0}
                width={slotW}
                height={chartH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                style={{ cursor: "pointer" }}
              >
                <title>{v.tooltip}</title>
              </rect>
              {v.label && (
                <text
                  x={i * slotW + slotW / 2}
                  y={chartH + 11}
                  textAnchor="middle"
                  fontFamily={FONT_MONO}
                  fontSize={6.5}
                  fill={C.mute}
                  fontWeight={700}
                  style={{ letterSpacing: "0.5px" }}
                >
                  {v.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* Tooltip flotante. Lo renderizamos en HTML (no SVG) para que el
          texto respete tipografía global y sea fácilmente estilizable. */}
      {hoverIdx != null && values[hoverIdx] && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: 0,
            left: `${(hoverIdx + 0.5) * (100 / values.length)}%`,
            transform: "translate(-50%, calc(-100% - 6px))",
            background: C.ink,
            color: C.paper,
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 0.4,
            fontWeight: 700,
            padding: "5px 9px",
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
