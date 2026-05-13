"use client";

/**
 * Mapa de mesas — sidebar izquierdo compacto del panel admin.
 *
 * Dos secciones: "Mesas" (físicas, kind=TABLE) y "Barras" (virtuales,
 * kind=BAR). Las mesas son fijas (su QR está impreso en la superficie
 * del local); las barras se crean/eliminan desde el botón "+" inline.
 *
 * Click en una celda con sesión abierta → drawer de cuenta. Click en
 * una celda sin sesión → modal "Abrir cuenta" (input de nombre + open).
 *
 * El operador ve TODO el salón de un vistazo, sin scroll horizontal y
 * con jerarquía visual clara: atención > ocupada > libre.
 */

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import type { Table } from "@coffee-bar/shared";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  fmt,
  pad,
  EASE_OUT_EXPO,
  DUR_BASE,
} from "@/lib/theme";
import { tablesApi, tableSessionsApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";

interface Props {
  tables: Table[];
  onSelect: (
    sessionId: number | null,
    tableNumber: number | null,
    table: Table,
  ) => void;
  /**
   * Called after a successful open/create/delete so the parent can
   * re-fetch tables. We intentionally lift the side-effect: this
   * component only knows how to ask, not where state lives.
   */
  onMutated?: () => void;
}

const STATUS_RANK: Record<string, number> = {
  occupied: 0,
  closing: 1,
  available: 2,
};

function sortTables(tables: Table[]): Table[] {
  return [...tables].sort((a, b) => {
    const aAttention =
      a.pending_request_count > 0 || a.active_order_count > 0 ? 0 : 1;
    const bAttention =
      b.pending_request_count > 0 || b.active_order_count > 0 ? 0 : 1;
    if (aAttention !== bAttention) return aAttention - bAttention;
    const rs = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (rs !== 0) return rs;
    if (b.pending_request_count !== a.pending_request_count) {
      return b.pending_request_count - a.pending_request_count;
    }
    return (a.number ?? a.id) - (b.number ?? b.id);
  });
}

export function TablesMap({ tables, onSelect, onMutated }: Props) {
  // Default kind to "TABLE" for any rows that came from a backend
  // without the kind column (defensive — the backend always sends it
  // post-migration, but this keeps the UI robust if the cache is stale).
  const realTables = tables.filter((t) => (t.kind ?? "TABLE") === "TABLE");
  // Solo mostramos barras CON sesión activa. Las barras cerradas siguen
  // en la base (porque borrarlas haría cascade a Consumption y los
  // ingresos del día desaparecerían), pero no las queremos llenando la
  // grilla — una vez cobrada, la barra ya no es operable.
  const bars = tables.filter(
    (t) => t.kind === "BAR" && t.current_session_id != null,
  );

  const sortedTables = sortTables(realTables);
  const sortedBars = sortTables(bars);

  const [openingWalkin, setOpeningWalkin] = useState(false);
  const [openingTable, setOpeningTable] = useState<number | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleSelect: Props["onSelect"] = async (sessionId, number, table) => {
    if (sessionId != null) {
      onSelect(sessionId, number, table);
      return;
    }
    // No session → open it directly. Tables don't ask for a name.
    if (openingTable != null) return;
    setOpeningTable(table.id);
    setOpenError(null);
    try {
      await tableSessionsApi.openByAdmin(table.id);
      onMutated?.();
    } catch (err) {
      setOpenError(getErrorMessage(err));
    } finally {
      setOpeningTable(null);
    }
  };

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        background: C.paper,
        borderRight: `1px solid ${C.sand}`,
        minWidth: 260,
        width: 280,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "16px 18px 12px",
          borderBottom: `1px solid ${C.sand}`,
          background: `linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 3,
            color: C.mute,
            fontWeight: 700,
            textTransform: "uppercase",
            marginBottom: 2,
          }}
        >
          — Salón
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 20,
              color: C.ink,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Mesas y barras
          </span>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <Section
          label="Mesas"
          count={`${realTables.filter((t) => t.status === "occupied").length}/${realTables.length}`}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
            }}
          >
            {sortedTables.map((t, i) => (
              <TableCell
                key={t.id}
                table={t}
                index={i}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </Section>

        <Section
          label="Cuentas sin mesa"
          count={`${bars.length}`}
          action={
            <button
              type="button"
              onClick={() => setOpeningWalkin(true)}
              aria-label="Abrir nueva cuenta sin mesa"
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 2,
                color: C.cacao,
                background: "transparent",
                border: `1px solid ${C.sand}`,
                borderRadius: 999,
                padding: "3px 10px",
                cursor: "pointer",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              + Nueva cuenta
            </button>
          }
        >
          {bars.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.mute,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                padding: "8px 4px",
              }}
            >
              Sin cuentas abiertas
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(1, 1fr)",
                gap: 8,
              }}
            >
              {sortedBars.map((t, i) => (
                <BarCell
                  key={t.id}
                  table={t}
                  index={i}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      {openError && (
        <div
          style={{
            margin: "0 12px 12px",
            padding: "8px 10px",
            background: C.terracottaSoft,
            color: C.terracotta,
            borderRadius: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 0.5,
          }}
          role="alert"
        >
          {openError}
        </div>
      )}

      {openingWalkin && (
        <WalkInAccountModal
          onCancel={() => setOpeningWalkin(false)}
          onOpened={() => {
            setOpeningWalkin(false);
            onMutated?.();
          }}
        />
      )}
    </aside>
  );
}

function Section({
  label,
  count,
  action,
  children,
}: {
  label: string;
  count: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "0 2px 6px",
          marginBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 2.5,
              color: C.cacao,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.mute,
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Bar cell — wider, single column, shows the custom_name prominently.
 * Visually distinct from TableCell so staff don't confuse the two.
 * Walk-in accounts are auto-deleted when their session closes, so
 * there's no manual delete affordance here.
 */
function BarCell({
  table,
  index,
  onSelect,
}: {
  table: Table;
  index: number;
  onSelect: Props["onSelect"];
}) {
  const isOccupied = table.status === "occupied";
  const customName = table.current_session?.custom_name ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: DUR_BASE / 1000,
        ease: [0.16, 1, 0.3, 1],
        delay: Math.min(index * 0.02, 0.2),
      }}
      style={{
        position: "relative",
        background: isOccupied
          ? `color-mix(in srgb, ${C.goldSoft} 50%, ${C.paper})`
          : C.paper,
        border: `1px dashed ${isOccupied ? C.gold : C.sand}`,
        borderRadius: 12,
        padding: "10px 12px",
        opacity: isOccupied ? 1 : 0.78,
        boxShadow: C.shadow,
      }}
    >
      <button
        type="button"
        onClick={() =>
          onSelect(
            table.current_session_id ?? null,
            table.number ?? table.id,
            table,
          )
        }
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          width: "100%",
          flexDirection: "column",
          gap: 4,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 2.5,
              color: isOccupied ? C.cacao : C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Barra
          </span>
          <StatusDot
            status={table.status}
            attention={table.pending_request_count > 0}
          />
        </div>
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 18,
            color: isOccupied ? C.ink : C.mute,
            letterSpacing: 0.5,
            lineHeight: 1.1,
          }}
        >
          {customName ??
            (isOccupied
              ? `Cuenta ${table.current_session_id ?? table.id}`
              : "Disponible")}
        </span>
        {isOccupied && (
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              color: C.gold,
              letterSpacing: 0.3,
            }}
          >
            {fmt(table.total_consumption)}
          </span>
        )}
      </button>
    </motion.div>
  );
}

/**
 * One modal for the entire "open a walk-in account" flow. Asks for a
 * name + a confirmation, then hits the back-end endpoint that creates
 * the virtual BAR row and opens its session in a single call.
 */
function WalkInAccountModal({
  onCancel,
  onOpened,
}: {
  onCancel: () => void;
  onOpened: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      setError("Ingresa un nombre para la cuenta");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await tablesApi.openWalkInAccount(name.trim());
      onOpened();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      onClose={onCancel}
      title="Nueva cuenta sin mesa"
      subtitle="Confirmar"
    >
      <form
        onSubmit={submit}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: C.cacao,
            lineHeight: 1.5,
          }}
        >
          ¿Seguro que deseas abrir una nueva cuenta sin mesa?
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 2,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Nombre de la cuenta
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Camilo"
            maxLength={80}
            autoFocus
            style={modalInputStyle}
          />
        </label>
        {error && <ErrorBanner text={error} />}
        <ModalButtons
          submitting={submitting}
          submitLabel="Abrir cuenta"
          onCancel={onCancel}
        />
      </form>
    </ModalShell>
  );
}

function ModalShell({
  onClose,
  title,
  subtitle,
  children,
}: {
  onClose: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 380,
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 16,
          padding: 22,
          boxShadow: "0 30px 80px -30px rgba(43,29,20,0.5)",
          fontFamily: FONT_UI,
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.gold,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — {subtitle}
          </div>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              color: C.ink,
              letterSpacing: 1,
              margin: "4px 0 0",
              lineHeight: 1.1,
            }}
          >
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalButtons({
  submitting,
  submitLabel,
  onCancel,
}: {
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        style={{
          padding: "8px 14px",
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          fontFamily: FONT_MONO,
          fontWeight: 700,
          color: C.cacao,
          background: "transparent",
          border: `1px solid ${C.sand}`,
          borderRadius: 999,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "8px 16px",
          fontSize: 11,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          color: C.paper,
          background: submitting
            ? C.sand
            : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
          border: "none",
          borderRadius: 999,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Guardando..." : submitLabel}
      </button>
    </div>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        padding: 8,
        borderRadius: 8,
        background: C.terracottaSoft,
        color: C.terracotta,
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: 0.5,
      }}
    >
      {text}
    </p>
  );
}

const modalInputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 10,
  background: C.parchment,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 14,
  outline: "none",
  width: "100%",
};

function TableCell({
  table,
  index,
  onSelect,
}: {
  table: Table;
  index: number;
  onSelect: Props["onSelect"];
}) {
  const isAvailable = table.status === "available";
  const isOccupied = table.status === "occupied";
  const needsAttention = table.pending_request_count > 0;
  const hasOrders = table.active_order_count > 0;
  const paidRequested = Boolean(table.current_session?.payment_requested_at);

  // Color del card: alert si pide atención, success si está activa sin
  // alertas, idle si está libre. El "warm" (gold) lo reservamos para
  // pago solicitado — se muestra como ribbon, no como tono base.
  let toneBg: string;
  let toneBorder: string;
  let numberColor: string;
  if (needsAttention) {
    toneBg = `color-mix(in srgb, ${C.terracottaSoft} 35%, ${C.paper})`;
    toneBorder = C.terracotta;
    numberColor = C.terracotta;
  } else if (isOccupied) {
    toneBg = `color-mix(in srgb, ${C.oliveSoft} 25%, ${C.paper})`;
    toneBorder = C.olive;
    numberColor = C.ink;
  } else {
    toneBg = C.paper;
    toneBorder = C.sand;
    numberColor = C.mute;
  }

  const handleClick = () => {
    onSelect(
      table.current_session_id ?? null,
      table.number ?? table.id,
      table,
    );
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DUR_BASE / 1000,
        ease: [0.16, 1, 0.3, 1],
        delay: Math.min(index * 0.02, 0.2),
      }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      style={{
        position: "relative",
        textAlign: "left",
        background: toneBg,
        border: `1px solid ${needsAttention ? toneBorder : C.sand}`,
        borderRadius: 12,
        padding: "10px 12px",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        opacity: isAvailable ? 0.62 : 1,
        boxShadow: needsAttention
          ? `0 0 0 0 ${C.terracotta}, 0 1px 0 rgba(43,29,20,0.04)`
          : C.shadow,
        transition: `box-shadow ${DUR_BASE}ms ${EASE_OUT_EXPO}`,
        overflow: "hidden",
      }}
    >
      {/* Pulse ring para mesas que piden atención. El ring es decorativo,
          se renderiza en absoluta para no afectar el layout. */}
      {needsAttention && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -1,
            borderRadius: 12,
            border: `1px solid ${C.terracotta}`,
            animation: "crown-cell-ping 1.6s ease-out infinite",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Header: número + dot status */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 6,
        }}
      >
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 26,
            color: numberColor,
            letterSpacing: 0,
            lineHeight: 1,
          }}
        >
          {pad(table.number ?? table.id)}
        </span>
        <StatusDot
          status={table.status}
          attention={needsAttention}
        />
      </div>

      {/* Consumo */}
      {!isAvailable && (
        <div
          style={{
            marginTop: 8,
            fontFamily: FONT_DISPLAY,
            fontSize: 13,
            color: C.gold,
            letterSpacing: 0.3,
            lineHeight: 1,
          }}
        >
          {fmt(table.total_consumption)}
        </div>
      )}

      {/* Mini-badges horizontales */}
      {(needsAttention || hasOrders || paidRequested) && (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          {needsAttention && (
            <MiniBadge
              label={`${table.pending_request_count}`}
              tone="alert"
              icon="●"
            />
          )}
          {hasOrders && (
            <MiniBadge
              label={`${table.active_order_count}`}
              tone="warm"
              icon="◆"
            />
          )}
          {paidRequested && (
            <MiniBadge label="$" tone="warm-fill" icon="" />
          )}
        </div>
      )}
    </motion.button>
  );
}

function StatusDot({
  status,
  attention,
}: {
  status: string;
  attention: boolean;
}) {
  let color: string;
  if (attention) color = C.terracotta;
  else if (status === "occupied") color = C.olive;
  else if (status === "closing") color = C.gold;
  else color = C.mute;

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        width: 10,
        height: 10,
        flexShrink: 0,
        marginTop: 6,
      }}
    >
      {(attention || status === "occupied") && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            background: color,
            opacity: 0.55,
            animation: "crown-ping 1.8s ease-out infinite",
          }}
        />
      )}
      <span
        style={{
          position: "relative",
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
        }}
      />
    </span>
  );
}

function MiniBadge({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: "alert" | "warm" | "warm-fill";
  icon: string;
}) {
  const palette = {
    alert: { bg: C.terracottaSoft, fg: C.terracotta, border: C.terracotta },
    warm: { bg: C.goldSoft, fg: C.cacao, border: C.gold },
    "warm-fill": { bg: C.gold, fg: C.paper, border: C.gold },
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}55`,
        fontFamily: FONT_MONO,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.4,
        lineHeight: 1,
      }}
    >
      {icon && <span style={{ fontSize: 7 }}>{icon}</span>}
      {label}
    </span>
  );
}
