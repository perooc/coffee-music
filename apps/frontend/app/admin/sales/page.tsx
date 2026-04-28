"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  salesInsightsApi,
  type ProductSalesSummary,
  type SalesInsightsResponse,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";

const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  burgundy: "#8B2635",
  burgundySoft: "#E8CDD2",
  olive: "#6B7E4A",
  oliveSoft: "#E5EAD3",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
};
const FONT_DISPLAY = "var(--font-bebas)";
const FONT_MONO = "var(--font-oswald)";
const FONT_UI = "var(--font-manrope)";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export default function AdminSalesPage() {
  const [days, setDays] = useState<1 | 7 | 30>(1);
  const [data, setData] = useState<SalesInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await salesInsightsApi.get({ days });
      setData(res);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
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
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            color: C.cacao,
            textDecoration: "none",
            border: `1px solid ${C.sand}`,
            padding: "8px 14px",
            borderRadius: 999,
            background: C.paper,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          ← Tablero
        </Link>
      </header>

      <section
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 18,
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
          }}
        >
          Rango:
        </span>
        {([1, 7, 30] as const).map((n) => {
          const active = days === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => setDays(n)}
              style={{
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
              }}
            >
              {n === 1 ? "Hoy" : `${n} días`}
            </button>
          );
        })}
      </section>

      {error && (
        <div
          role="alert"
          style={{
            padding: 10,
            borderRadius: 8,
            background: C.burgundySoft,
            color: C.burgundy,
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
          <SummaryCards summary={data.summary} />

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
                          <strong style={{ color: C.burgundy }}>
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
                          background: C.burgundySoft,
                          color: C.burgundy,
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
  );
}

function SummaryCards({
  summary,
}: {
  summary: SalesInsightsResponse["summary"];
}) {
  const cards: { label: string; value: string; color: string }[] = [
    {
      label: "Unidades vendidas",
      value: String(summary.total_units),
      color: C.olive,
    },
    {
      label: "Ingresos",
      value: fmt(summary.total_revenue),
      color: C.gold,
    },
    {
      label: "Productos vendidos",
      value: String(summary.distinct_products_sold),
      color: C.ink,
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        marginBottom: 16,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: C.paper,
            border: `1px solid ${C.sand}`,
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 26,
              color: c.color,
              letterSpacing: 0.5,
            }}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
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
