"use client";

/**
 * Mapa de mesas — sidebar izquierdo compacto del panel admin.
 *
 * Cambio de IA: la columna anterior mostraba cards verticales largas con
 * scroll. Aquí mostramos TODAS las mesas a la vez en un grid de 2 columnas
 * para que el operador vea el estado del salón de un solo vistazo, sin
 * mover el cursor. El detalle (cuenta, items, etc.) se abre en drawer al
 * click — el card es el "trigger", no el "container".
 *
 * Cada celda muestra:
 *   - Número de mesa grande (Bebas).
 *   - Dot de status (success/alert/idle según ocupación + atención).
 *   - Mini-badges sutiles para: solicitud pendiente, pedido en curso,
 *     pago solicitado.
 *   - Consumo en pequeño abajo, solo si está ocupada.
 *
 * Orden de prioridad (para que la primera fila sea siempre lo que pide
 * atención): atención > ocupada > cerrando > disponible.
 */

import { motion } from "framer-motion";
import type { Table } from "@coffee-bar/shared";
import { C, FONT_DISPLAY, FONT_MONO, fmt, pad, EASE_OUT_EXPO, DUR_BASE } from "@/lib/theme";

interface Props {
  tables: Table[];
  onSelect: (
    sessionId: number | null,
    tableNumber: number | null,
    table: Table,
  ) => void;
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

export function TablesMap({ tables, onSelect }: Props) {
  const sorted = sortTables(tables);
  const occupiedCount = tables.filter((t) => t.status === "occupied").length;

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
            Mesas
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.mute,
              fontWeight: 600,
            }}
          >
            {occupiedCount}/{tables.length} ocupadas
          </span>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
          alignContent: "start",
        }}
      >
        {sorted.map((t, i) => (
          <TableCell
            key={t.id}
            table={t}
            index={i}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  );
}

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
