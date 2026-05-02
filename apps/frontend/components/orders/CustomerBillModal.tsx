"use client";

/**
 * Customer-facing bill view.
 *
 * - Reads the live bill from the backend (single source of truth from
 *   Phase D). Updates via socket `bill:updated`.
 * - Consolidates Consumption rows by (product_id, unit_amount) so the
 *   customer sees one line per dish instead of one row per unit.
 * - Footer changes shape based on the session's payment state:
 *     null → "Pedir cuenta" (disabled if there are active orders)
 *     payment_requested_at  → "Pago solicitado" + "Cancelar"
 *     paid_at               → "Pagada — gracias"
 */
import { useMemo, useState } from "react";
import { tableSessionsApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { BillView, Consumption, TableSession } from "@coffee-bar/shared";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  terracotta: "#8B2635",
  terracottaSoft: "#E8CDD2",
  olive: "#6B7E4A",
  oliveSoft: "#E5EAD3",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
};
const FONT_HEADING = "var(--font-blackletter), 'Old English Text MT', serif";
const FONT_DISPLAY = "var(--font-bebas)";
const FONT_MONO = "var(--font-manrope)";
const FONT_UI = "var(--font-manrope)";

type Line = {
  key: string;
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  type: Consumption["type"];
  reason: string | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  bill: BillView | null;
  session: TableSession;
  /** Number of orders/requests blocking "request payment". */
  inFlightCount: number;
}

export function CustomerBillModal({
  open,
  onClose,
  bill,
  session,
  inFlightCount,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productLines = useMemo<Line[]>(() => {
    if (!bill) return [];
    // Consolidate the per-unit Consumption rows back into per-product
    // lines. Two rows are part of the same line iff they share product_id
    // AND unit_amount (the price snapshot at delivery time).
    const byKey = new Map<string, Line>();
    for (const c of bill.items) {
      if (c.type !== "product" || c.reversed_at != null) continue;
      const key = `${c.product_id}::${c.unit_amount}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += c.quantity;
        existing.amount += Number(c.amount);
      } else {
        byKey.set(key, {
          key,
          description: c.description,
          quantity: c.quantity,
          unit_amount: Number(c.unit_amount),
          amount: Number(c.amount),
          type: c.type,
          reason: c.reason,
        });
      }
    }
    return Array.from(byKey.values());
  }, [bill]);

  const adjustmentLines = useMemo<Line[]>(() => {
    if (!bill) return [];
    return bill.items
      .filter(
        (c) => c.type !== "product" && c.reversed_at == null,
      )
      .map((c) => ({
        key: `adj-${c.id}`,
        description: c.description,
        quantity: c.quantity,
        unit_amount: Number(c.unit_amount),
        amount: Number(c.amount),
        type: c.type,
        reason: c.reason,
      }));
  }, [bill]);

  if (!open) return null;

  const paid = session.paid_at != null;
  const requested = session.payment_requested_at != null && !paid;
  const blockReason =
    inFlightCount > 0
      ? `Espera a que entreguen tu pedido (${inFlightCount} en proceso) antes de pedir cuenta.`
      : null;
  const canRequest = !paid && !requested && blockReason == null;

  async function handleRequestPayment() {
    setSubmitting(true);
    setError(null);
    try {
      await tableSessionsApi.requestPayment(session.id);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      // ALREADY_REQUESTED / ALREADY_PAID are not real errors from the
      // user's perspective — they only happen if the user double-clicks
      // before the socket update arrives. Swallow silently; the toast +
      // session merge will reflect the real state in milliseconds.
      if (
        code === "TABLE_SESSION_PAYMENT_ALREADY_REQUESTED" ||
        code === "TABLE_SESSION_ALREADY_PAID"
      ) {
        return;
      }
      const map: Record<string, string> = {
        TABLE_SESSION_HAS_PENDING_OR_ACTIVE_ORDERS:
          "No puedes pedir cuenta con pedidos en proceso.",
        TABLE_SESSION_CLOSED: "La sesión está cerrada.",
      };
      setError(map[code ?? ""] ?? getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelRequest() {
    setSubmitting(true);
    setError(null);
    try {
      await tableSessionsApi.cancelPaymentRequest(session.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Factura"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 540,
          maxHeight: "92dvh",
          background: C.paper,
          borderRadius: "20px 20px 0 0",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -20px 60px -20px rgba(43,29,20,0.45)",
        }}
      >
        <header
          style={{
            padding: "18px 22px 14px",
            borderBottom: `1px solid ${C.sand}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 3,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              — Tu cuenta
            </span>
            <h2
              style={{
                fontFamily: FONT_HEADING,
                fontSize: 36,
                letterSpacing: 0,
                color: C.ink,
                margin: 0,
                lineHeight: 1,
              }}
            >
              Factura
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: `1px solid ${C.sand}`,
              borderRadius: 999,
              width: 36,
              height: 36,
              fontSize: 18,
              color: C.cacao,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </header>

        <div
          style={{ flex: 1, overflowY: "auto", padding: "16px 22px 18px" }}
        >
          {bill == null && (
            <p
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              Cargando...
            </p>
          )}

          {bill != null && productLines.length === 0 && adjustmentLines.length === 0 && (
            <p
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
            >
              Aún no hay consumos
            </p>
          )}

          {bill != null && productLines.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <header
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 38px 70px 80px",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: `1px solid ${C.sand}`,
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  letterSpacing: 2,
                  color: C.mute,
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                <span>Producto</span>
                <span style={{ textAlign: "right" }}>Cant.</span>
                <span style={{ textAlign: "right" }}>Unit.</span>
                <span style={{ textAlign: "right" }}>Total</span>
              </header>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {productLines.map((l) => (
                  <li
                    key={l.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 38px 70px 80px",
                      gap: 8,
                      padding: "10px 0",
                      borderBottom: `1px solid ${C.sand}`,
                      alignItems: "baseline",
                      fontFamily: FONT_UI,
                      fontSize: 14,
                    }}
                  >
                    <span
                      style={{
                        color: C.ink,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {l.description}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        fontFamily: FONT_DISPLAY,
                        fontSize: 16,
                        color: C.gold,
                      }}
                    >
                      {l.quantity}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        color: C.cacao,
                      }}
                    >
                      {fmt(l.unit_amount)}
                    </span>
                    <span
                      style={{
                        textAlign: "right",
                        fontFamily: FONT_DISPLAY,
                        fontSize: 16,
                        color: C.ink,
                      }}
                    >
                      {fmt(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {bill != null && adjustmentLines.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <h3
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  letterSpacing: 2,
                  color: C.mute,
                  textTransform: "uppercase",
                  fontWeight: 700,
                  margin: "0 0 6px",
                }}
              >
                — Ajustes
              </h3>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {adjustmentLines.map((l) => (
                  <li
                    key={l.key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: `1px solid ${C.sand}`,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontFamily: FONT_UI,
                          fontSize: 13,
                          color: C.ink,
                        }}
                      >
                        {l.description}
                      </div>
                      {l.reason && (
                        <div
                          style={{
                            fontFamily: FONT_UI,
                            fontSize: 11,
                            color: C.cacao,
                            fontStyle: "italic",
                          }}
                        >
                          “{l.reason}”
                        </div>
                      )}
                    </div>
                    <span
                      style={{
                        fontFamily: FONT_DISPLAY,
                        fontSize: 16,
                        color: l.amount < 0 ? C.olive : C.ink,
                      }}
                    >
                      {fmt(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {bill != null && (
            <div
              style={{
                marginTop: 14,
                padding: "14px 16px",
                background: C.cream,
                border: `1px solid ${C.sand}`,
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <SummaryRow label="Subtotal" value={bill.summary.subtotal} />
              {bill.summary.discounts_total !== 0 && (
                <SummaryRow
                  label="Descuentos"
                  value={bill.summary.discounts_total}
                />
              )}
              {bill.summary.adjustments_total !== 0 && (
                <SummaryRow
                  label="Ajustes"
                  value={bill.summary.adjustments_total}
                />
              )}
              <SummaryRow
                label="Total"
                value={bill.summary.total}
                emphasis
              />
            </div>
          )}
        </div>

        <footer
          style={{
            padding: "14px 22px calc(14px + env(safe-area-inset-bottom))",
            borderTop: `1px solid ${C.sand}`,
            background: C.cream,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {paid && (
            <Banner
              tone="olive"
              title="Pagada — ¡gracias!"
              body="Tu cuenta ya fue cobrada. Disfruta el resto de la noche."
            />
          )}
          {requested && (
            <Banner
              tone="gold"
              title="Pago solicitado"
              body="El bar se acercará pronto. Mientras tanto, no puedes agregar más productos."
            />
          )}
          {error && (
            <p
              role="alert"
              style={{
                margin: 0,
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.terracotta,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              {error}
            </p>
          )}

          {!paid && !requested && (
            <button
              type="button"
              onClick={handleRequestPayment}
              disabled={!canRequest || submitting}
              style={primaryButton(!canRequest || submitting)}
            >
              {submitting ? "Solicitando..." : "Pedir cuenta"}
            </button>
          )}
          {!paid && !requested && blockReason && (
            <p
              style={{
                margin: 0,
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.cacao,
                letterSpacing: 1,
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              {blockReason}
            </p>
          )}

          {requested && (
            <button
              type="button"
              onClick={handleCancelRequest}
              disabled={submitting}
              style={secondaryButton(submitting)}
            >
              {submitting ? "Cancelando..." : "Cancelar solicitud"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingTop: emphasis ? 8 : 0,
        borderTop: emphasis ? `1px solid ${C.sand}` : "none",
        marginTop: emphasis ? 4 : 0,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: emphasis ? 11 : 10,
          letterSpacing: 2,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: emphasis ? 700 : 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: emphasis ? FONT_HEADING : FONT_DISPLAY,
          fontSize: emphasis ? 34 : 18,
          color: emphasis ? C.gold : C.ink,
          letterSpacing: emphasis ? 0 : 0.5,
        }}
      >
        {fmt(value)}
      </span>
    </div>
  );
}

function Banner({
  tone,
  title,
  body,
}: {
  tone: "gold" | "olive";
  title: string;
  body: string;
}) {
  const palette = tone === "olive"
    ? { bg: C.oliveSoft, border: C.olive, fg: C.olive }
    : { bg: C.goldSoft, border: C.gold, fg: C.cacao };
  return (
    <div
      role="status"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 14,
          letterSpacing: 2,
          color: palette.fg,
          textTransform: "uppercase",
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: FONT_UI,
          fontSize: 12,
          color: palette.fg,
          lineHeight: 1.4,
        }}
      >
        {body}
      </span>
    </div>
  );
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "16px 20px",
    border: "none",
    borderRadius: 999,
    background: disabled
      ? C.sand
      : "linear-gradient(135deg, #B8894A 0%, #C9944F 100%)",
    color: disabled ? C.mute : C.paper,
    fontFamily: FONT_DISPLAY,
    fontSize: 16,
    letterSpacing: 3,
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function secondaryButton(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "14px 18px",
    border: `1px solid ${C.cacao}`,
    borderRadius: 999,
    background: C.paper,
    color: C.ink,
    fontFamily: FONT_DISPLAY,
    fontSize: 14,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
