"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
            <Panel title="Reponer pronto">
              {data.low_stock_high_demand.length === 0 ? (
                <Empty text="Sin productos críticos" />
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {data.low_stock_high_demand.map((p) => (
                    <li
                      key={p.product_id}
                      style={{
                        padding: "10px 0",
                        borderBottom: `1px solid ${C.sand}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
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
                          {p.category} · vendidos {p.units_sold} · stock{" "}
                          <strong style={{ color: C.terracotta }}>
                            {p.stock}
                          </strong>
                          {p.low_stock_threshold > 0 && (
                            <> / umbral {p.low_stock_threshold}</>
                          )}
                        </div>
                      </div>
                      <span
                        style={{
                          padding: "2px 10px",
                          borderRadius: 999,
                          background: C.terracottaSoft,
                          color: C.terracotta,
                          fontFamily: FONT_MONO,
                          fontSize: 9,
                          letterSpacing: 1.5,
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        Reponer
                      </span>
                    </li>
                  ))}
                </ul>
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
                        padding: "10px 0",
                        borderBottom: `1px solid ${C.sand}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
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
          label="Ingresos"
          value={fmt(summary.total_revenue)}
          tone="warm"
          previous={previous.total_revenue}
          current={summary.total_revenue}
          spark={daily.map((d) => d.revenue)}
          formatPrev={fmt}
        />
        <KpiCard
          label="Tickets"
          value={String(summary.tickets_count)}
          tone="success"
          previous={previous.tickets_count}
          current={summary.tickets_count}
          spark={daily.map((d) => d.tickets)}
        />
        <KpiCard
          label="Ticket promedio"
          value={summary.tickets_count > 0 ? fmt(summary.avg_ticket) : "—"}
          tone="neutral"
          previous={previous.avg_ticket}
          current={summary.avg_ticket}
          formatPrev={fmt}
        />
        <KpiCard
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
}) {
  const valueColor = TONE_COLOR[tone];
  const delta = computeDelta(current, previous);
  return (
    <div
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
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 26,
            color: valueColor,
            letterSpacing: 0.5,
            lineHeight: 1,
          }}
        >
          {value}
        </span>
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
    </div>
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

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
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
    </section>
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
            padding: "10px 0",
            borderBottom:
              i === rows.length - 1 ? "none" : `1px solid ${C.sand}`,
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 10,
            alignItems: "center",
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
