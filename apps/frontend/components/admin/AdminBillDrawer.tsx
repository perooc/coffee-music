"use client";

/**
 * Admin bill drawer for a single TableSession.
 *
 * Strict separation (Phase F3):
 *   - bill.summary / bill.items → backend ledger, single source of truth.
 *   - We never sum from orders in the UI.
 *   - Staff actions (adjustment / discount / refund) are three separate,
 *     explicit flows with mandatory reason.
 *   - A closed session is read-only; action UI is hidden.
 *   - `reason` is always visible on the ledger row so operators and support
 *     can audit why the bill changed.
 */
import { useCallback, useEffect, useState } from "react";
import { useSocket } from "@/lib/socket/useSocket";
import { billApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { BillView, Consumption } from "@coffee-bar/shared";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const pad = (n: number) => String(n).padStart(2, "0");

const C = {
  cream: "#FDF8EC",
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

type ActionKind = "adjustment" | "discount" | "refund";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: number | null;
  tableNumber: number | null;
}

export function AdminBillDrawer({
  open,
  onClose,
  sessionId,
  tableNumber,
}: Props) {
  const [bill, setBill] = useState<BillView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionOpen, setActionOpen] = useState<null | {
    kind: ActionKind;
    consumptionId?: number;
    defaultDescription?: string;
  }>(null);

  const load = useCallback(() => {
    if (sessionId == null) return;
    setLoadError(null);
    billApi
      .getForAdmin(sessionId)
      .then(setBill)
      .catch((e: unknown) => setLoadError(getErrorMessage(e)));
  }, [sessionId]);

  useEffect(() => {
    if (open && sessionId != null) load();
    if (!open) setBill(null);
  }, [open, sessionId, load]);

  // Subscribe to bill updates for this session. Filter by session_id to avoid
  // cross-session cross-talk even though staff broadcast is global today.
  useSocket({
    staff: true,
    onBillUpdated: (b) => {
      if (sessionId != null && b.session_id === sessionId) setBill(b);
    },
  });

  if (!open || sessionId == null) return null;

  const readOnly = bill?.status === "closed";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Cuenta de mesa"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          height: "100%",
          background: C.paper,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 60px -20px rgba(43,29,20,0.45)",
        }}
      >
        <BillHeader
          tableNumber={tableNumber}
          bill={bill}
          onClose={onClose}
        />

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 22px 24px",
          }}
        >
          {loadError && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: 12,
                background: C.burgundySoft,
                color: C.burgundy,
                borderRadius: 8,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              {loadError}
            </p>
          )}

          {bill && (
            <>
              <SummaryGrid summary={bill.summary} />
              <LedgerList
                items={bill.items}
                readOnly={readOnly}
                onRefund={(c) =>
                  setActionOpen({
                    kind: "refund",
                    consumptionId: c.id,
                    defaultDescription: c.description,
                  })
                }
              />
            </>
          )}
        </div>

        {!readOnly && bill && (
          <footer
            style={{
              padding: "14px 22px calc(14px + env(safe-area-inset-bottom))",
              borderTop: `1px solid ${C.sand}`,
              background: C.cream,
              display: "flex",
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={() => setActionOpen({ kind: "adjustment" })}
              style={adjustmentButtonStyle(C.gold)}
            >
              + Cargo manual
            </button>
            <button
              type="button"
              onClick={() => setActionOpen({ kind: "discount" })}
              style={adjustmentButtonStyle(C.cacao)}
            >
              − Descuento
            </button>
          </footer>
        )}

        {readOnly && (
          <footer
            style={{
              padding: "14px 22px calc(14px + env(safe-area-inset-bottom))",
              borderTop: `1px solid ${C.sand}`,
              background: C.cream,
              textAlign: "center",
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
            }}
          >
            Sesión cerrada — sólo lectura
          </footer>
        )}
      </aside>

      {actionOpen && sessionId != null && (
        <ActionModal
          kind={actionOpen.kind}
          sessionId={sessionId}
          consumptionId={actionOpen.consumptionId}
          defaultDescription={actionOpen.defaultDescription}
          onClose={() => setActionOpen(null)}
          onDone={() => {
            setActionOpen(null);
            // bill:updated will refresh the drawer; no manual refetch.
          }}
        />
      )}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
function BillHeader({
  tableNumber,
  bill,
  onClose,
}: {
  tableNumber: number | null;
  bill: BillView | null;
  onClose: () => void;
}) {
  const statusColor: Record<string, { bg: string; fg: string }> = {
    open: { bg: C.oliveSoft, fg: C.olive },
    ordering: { bg: C.oliveSoft, fg: C.olive },
    closing: { bg: C.goldSoft, fg: C.cacao },
    closed: { bg: C.sand, fg: C.mute },
  };
  const statusMeta = bill
    ? statusColor[bill.status] ?? { bg: C.sand, fg: C.mute }
    : { bg: C.sand, fg: C.mute };
  return (
    <header
      style={{
        padding: "20px 22px 16px",
        borderBottom: `1px solid ${C.sand}`,
        background: C.paper,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
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
          — Cuenta
        </span>
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 32,
            letterSpacing: 0.5,
            color: C.ink,
            margin: "2px 0 0",
            lineHeight: 1,
          }}
        >
          Mesa {tableNumber != null ? pad(tableNumber) : "—"}
        </h2>
        {bill && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                background: statusMeta.bg,
                color: statusMeta.fg,
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1.5,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {bill.status}
            </span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.mute,
                letterSpacing: 1,
              }}
            >
              abierta {new Date(bill.opened_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
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
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────
function SummaryGrid({ summary }: { summary: BillView["summary"] }) {
  const rows: { label: string; value: number; color: string; bold?: boolean }[] = [
    { label: "Subtotal", value: summary.subtotal, color: C.ink },
    { label: "Descuentos", value: summary.discounts_total, color: C.cacao },
    { label: "Ajustes", value: summary.adjustments_total, color: C.cacao },
    { label: "Total", value: summary.total, color: C.gold, bold: true },
  ];
  return (
    <div
      style={{
        border: `1px solid ${C.sand}`,
        borderRadius: 14,
        background: C.cream,
        padding: "14px 18px",
        marginBottom: 22,
      }}
    >
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "6px 0",
            borderTop: i === rows.length - 1 ? `1px solid ${C.sand}` : "none",
            marginTop: i === rows.length - 1 ? 8 : 0,
            paddingTop: i === rows.length - 1 ? 12 : 6,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: r.bold ? 11 : 10,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: r.bold ? 700 : 600,
            }}
          >
            {r.label}
          </span>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: r.bold ? 28 : 18,
              color: r.color,
              letterSpacing: 0.5,
            }}
          >
            {fmt(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Ledger ──────────────────────────────────────────────────────────────────
function LedgerList({
  items,
  readOnly,
  onRefund,
}: {
  items: Consumption[];
  readOnly: boolean;
  onRefund: (c: Consumption) => void;
}) {
  const typeMeta: Record<
    string,
    { label: string; bg: string; fg: string }
  > = {
    product: { label: "Producto", bg: C.goldSoft, fg: C.cacao },
    adjustment: { label: "Ajuste", bg: C.sandDark, fg: C.ink },
    discount: { label: "Descuento", bg: C.oliveSoft, fg: C.olive },
    refund: { label: "Reembolso", bg: C.burgundySoft, fg: C.burgundy },
  };

  return (
    <div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 3,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        — Detalle cronológico
      </div>
      {items.length === 0 && (
        <p
          style={{
            padding: "24px 0",
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.mute,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Sin movimientos
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((c) => {
          const meta = typeMeta[c.type] ?? {
            label: c.type,
            bg: C.sand,
            fg: C.ink,
          };
          const reversed = c.reversed_at != null;
          const canRefund =
            !readOnly &&
            !reversed &&
            c.type !== "refund" &&
            typeof onRefund === "function";
          return (
            <li
              key={c.id}
              style={{
                padding: "12px 0",
                borderBottom: `1px solid ${C.sand}`,
                opacity: reversed ? 0.55 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 14,
                      color: C.ink,
                      textDecoration: reversed ? "line-through" : "none",
                    }}
                  >
                    {c.description}
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: C.mute,
                      letterSpacing: 1,
                      marginTop: 3,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        padding: "1px 7px",
                        background: meta.bg,
                        color: meta.fg,
                        borderRadius: 999,
                        letterSpacing: 1,
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {meta.label}
                    </span>
                    {c.quantity !== 1 && <span>{c.quantity}×</span>}
                    <span>
                      {new Date(c.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {reversed && (
                      <span style={{ color: C.burgundy, fontWeight: 700 }}>
                        REVERSADA
                      </span>
                    )}
                    {c.reverses_id != null && (
                      <span>↻ Reversa #{c.reverses_id}</span>
                    )}
                  </div>
                  {c.reason && (
                    <div
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 12,
                        color: C.cacao,
                        fontStyle: "italic",
                        marginTop: 4,
                      }}
                    >
                      “{c.reason}”
                      {c.created_by && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontStyle: "normal",
                            color: C.mute,
                            fontSize: 11,
                          }}
                        >
                          · {c.created_by}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 18,
                    color: Number(c.amount) < 0 ? C.olive : C.gold,
                    letterSpacing: 0.5,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmt(Number(c.amount))}
                </div>
              </div>
              {canRefund && (
                <button
                  type="button"
                  onClick={() => onRefund(c)}
                  style={{
                    marginTop: 8,
                    padding: "4px 10px",
                    border: `1px solid ${C.burgundy}`,
                    background: "transparent",
                    color: C.burgundy,
                    borderRadius: 999,
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    cursor: "pointer",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  Devolver
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Action modal (adjustment | discount | refund) ───────────────────────────
function ActionModal({
  kind,
  sessionId,
  consumptionId,
  defaultDescription,
  onClose,
  onDone,
}: {
  kind: ActionKind;
  sessionId: number;
  consumptionId?: number;
  defaultDescription?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    kind === "adjustment"
      ? "Cargo manual"
      : kind === "discount"
        ? "Descuento"
        : "Devolver consumo";

  const amountNum = Number(amountStr);
  const amountValid =
    kind === "refund"
      ? true
      : amountStr.trim().length > 0 && Number.isFinite(amountNum) && amountNum !== 0;

  const reasonValid = reason.trim().length >= 3;
  const canSubmit = amountValid && reasonValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // `created_by` is stamped by the backend from the admin JWT (G6).
      // The UI used to accept a manual "Responsable" field; it is gone now.
      if (kind === "refund") {
        if (consumptionId == null) throw new Error("Missing consumption id");
        await billApi.refundConsumption(consumptionId, {
          reason: reason.trim(),
          notes: notes.trim() || undefined,
        });
      } else {
        await billApi.createAdjustment(sessionId, {
          type: kind,
          amount: amountNum,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
        });
      }
      onDone();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
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
            — Acción
          </span>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              letterSpacing: 0.5,
              color: C.ink,
              margin: "2px 0 0",
            }}
          >
            {title}
          </h3>
          {kind === "refund" && defaultDescription && (
            <p
              style={{
                margin: "6px 0 0",
                fontFamily: FONT_UI,
                fontSize: 13,
                color: C.cacao,
              }}
            >
              Consumo: <em>{defaultDescription}</em>
            </p>
          )}
        </div>

        {kind !== "refund" && (
          <label style={labelStyle}>
            <span style={labelTextStyle}>
              Monto (COP)
              {kind === "discount" && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    color: C.mute,
                  }}
                >
                  se registra como negativo
                </span>
              )}
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0"
              style={inputStyle}
            />
          </label>
        )}

        <label style={labelStyle}>
          <span style={labelTextStyle}>Razón (obligatoria)</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: cortesía, corrección manual, rotura…"
            maxLength={200}
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>Notas internas (opcional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            style={{ ...inputStyle, resize: "vertical", fontFamily: FONT_UI }}
          />
        </label>


        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: 10,
              background: C.burgundySoft,
              color: C.burgundy,
              borderRadius: 8,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 18px",
              border: `1px solid ${C.sand}`,
              background: "transparent",
              color: C.cacao,
              borderRadius: 999,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: canSubmit ? C.ink : C.sand,
              color: canSubmit ? C.paper : C.mute,
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              letterSpacing: 3,
              cursor: canSubmit ? "pointer" : "not-allowed",
              textTransform: "uppercase",
            }}
          >
            {submitting ? "Guardando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles helpers ──────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
};
const labelTextStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 2,
  color: C.mute,
  textTransform: "uppercase",
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 10,
  background: C.cream,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 14,
  outline: "none",
};

function adjustmentButtonStyle(borderColor: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "12px 0",
    border: `1px solid ${borderColor}`,
    borderRadius: 999,
    background: C.paper,
    color: C.ink,
    fontFamily: FONT_DISPLAY,
    fontSize: 13,
    letterSpacing: 2.5,
    cursor: "pointer",
    textTransform: "uppercase",
  };
}
