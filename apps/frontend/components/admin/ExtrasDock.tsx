"use client";

/**
 * Dock flotante de ingresos no-operacionales (baño + maletas). Vive en la
 * esquina inferior-derecha del /admin, siempre accesible.
 *
 * Diseño:
 *   - Colapsado: pill compacta con total del día y un botón "+" para
 *     expandir. Mínima intrusión visual.
 *   - Expandido: tres botones de cobro rápido + estado de maletas
 *     activas + atajo a /admin/sales tab Extras.
 *
 * El cobro de baño es 1-click (sin modal). Maleta abre un modal con el
 * formulario mínimo. Reverso se hace desde el tab Extras (no acá: el
 * dock es para "cobrar ahora", no para auditar).
 *
 * Estado: cada acción dispara un refetch del summary del día para que
 * el contador refleje el último cobro sin esperar a otro evento.
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  extraIncomeApi,
  luggageApi,
  type ExtraIncomeSummary,
  type LuggageSummary,
  type LuggageTicketApi,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI, fmt, DUR_BASE } from "@/lib/theme";
import { LuggageNewModal } from "./LuggageNewModal";

type Toast = { id: number; text: string; tone: "ok" | "alert" };

export function ExtrasDock() {
  const [open, setOpen] = useState(false);
  const [extras, setExtras] = useState<ExtraIncomeSummary | null>(null);
  const [luggage, setLuggage] = useState<LuggageSummary | null>(null);
  const [busy, setBusy] = useState<null | "male" | "female">(null);
  const [showLuggageModal, setShowLuggageModal] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const loadSummaries = useCallback(async () => {
    try {
      const [e, l] = await Promise.all([
        extraIncomeApi.summary(),
        luggageApi.summary(),
      ]);
      setExtras(e);
      setLuggage(l);
    } catch (err) {
      console.error("[ExtrasDock] summary error", err);
    }
  }, []);

  useEffect(() => {
    void loadSummaries();
    // Auto-refresh suave cada 60s para que el total del día se mantenga
    // vivo cuando alguien deja la pestaña abierta. No usamos sockets:
    // este modelo no emite eventos por ahora — overkill.
    const interval = setInterval(() => void loadSummaries(), 60_000);
    return () => clearInterval(interval);
  }, [loadSummaries]);

  const pushToast = (text: string, tone: "ok" | "alert" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      2400,
    );
  };

  const charge = async (subtype: "male" | "female") => {
    if (busy) return;
    setBusy(subtype);
    try {
      const res = await extraIncomeApi.createRestroom(subtype);
      pushToast(
        `Cobrado ${subtype === "male" ? "Baño H" : "Baño M"} · ${fmt(res.total_amount)}`,
      );
      void loadSummaries();
    } catch (err) {
      pushToast(getErrorMessage(err), "alert");
    } finally {
      setBusy(null);
    }
  };

  const onLuggageCreated = (ticket: LuggageTicketApi) => {
    pushToast(`Ficha ${ticket.ticket_number} registrada`);
    setShowLuggageModal(false);
    void loadSummaries();
  };

  const todayRevenue =
    (extras?.restroom.total.revenue ?? 0) + (luggage?.luggage.revenue ?? 0);

  return (
    <>
      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {/* Toasts */}
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: DUR_BASE / 1000 }}
              style={{
                pointerEvents: "auto",
                background: t.tone === "alert" ? C.terracottaSoft : C.paper,
                color: t.tone === "alert" ? C.terracotta : C.ink,
                border: `1px solid ${t.tone === "alert" ? C.terracotta : C.sand}`,
                borderRadius: 999,
                padding: "8px 14px",
                fontFamily: FONT_UI,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: "0 8px 24px -10px rgba(43,29,20,0.25)",
              }}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: DUR_BASE / 1000 }}
              style={{
                pointerEvents: "auto",
                width: 320,
                background: C.paper,
                border: `1px solid ${C.sand}`,
                borderRadius: 14,
                boxShadow: "0 16px 40px -12px rgba(43,29,20,0.35)",
                padding: "14px 14px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div>
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
                    Ingresos extra · hoy
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 22,
                      color: C.gold,
                      letterSpacing: 0.5,
                      marginTop: 2,
                    }}
                  >
                    {fmt(todayRevenue)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar"
                  style={{
                    width: 30,
                    height: 30,
                    border: `1px solid ${C.sand}`,
                    background: "transparent",
                    color: C.mute,
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </header>

              {/* Cobros rápidos baño */}
              <div style={{ display: "flex", gap: 8 }}>
                <QuickChargeButton
                  label="Baño H"
                  price={2000}
                  count={extras?.restroom.male.count ?? 0}
                  busy={busy === "male"}
                  onClick={() => void charge("male")}
                />
                <QuickChargeButton
                  label="Baño M"
                  price={2000}
                  count={extras?.restroom.female.count ?? 0}
                  busy={busy === "female"}
                  onClick={() => void charge("female")}
                />
              </div>

              {/* Maleta */}
              <button
                type="button"
                onClick={() => setShowLuggageModal(true)}
                style={{
                  padding: "10px 12px",
                  border: `1px solid ${C.cacao}`,
                  background: C.cream,
                  borderRadius: 12,
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  fontWeight: 600,
                  color: C.ink,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  textAlign: "left",
                }}
              >
                <span>
                  <span style={{ fontSize: 16, marginRight: 8 }}>🧳</span>
                  Nueva maleta
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: C.mute,
                  }}
                >
                  {luggage?.luggage.active_count ?? 0} activas
                </span>
              </button>

              {/* Mini breakdown del día */}
              {extras && (
                <div
                  style={{
                    paddingTop: 8,
                    borderTop: `1px dashed ${C.sand}`,
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: C.cacao,
                    letterSpacing: 1.2,
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    rowGap: 3,
                    columnGap: 12,
                    textTransform: "uppercase",
                  }}
                >
                  <span>
                    Baños hombre · {extras.restroom.male.count}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {fmt(extras.restroom.male.revenue)}
                  </span>
                  <span>
                    Baños mujer · {extras.restroom.female.count}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {fmt(extras.restroom.female.revenue)}
                  </span>
                  {luggage && luggage.luggage.count > 0 && (
                    <>
                      <span>
                        Maletas · {luggage.luggage.count}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {fmt(luggage.luggage.revenue)}
                      </span>
                    </>
                  )}
                </div>
              )}

              <a
                href="/admin/sales?tab=extras"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 1.5,
                  color: C.gold,
                  textTransform: "uppercase",
                  fontWeight: 700,
                  textDecoration: "none",
                  textAlign: "center",
                  padding: "6px 0 2px",
                }}
              >
                Ver detalle y reportes →
              </a>
            </motion.div>
          ) : (
            <motion.button
              key="collapsed"
              type="button"
              onClick={() => setOpen(true)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: DUR_BASE / 1000 }}
              aria-label="Abrir cobros rápidos"
              style={{
                pointerEvents: "auto",
                background: C.gold,
                color: C.paper,
                border: "none",
                borderRadius: 999,
                padding: "12px 18px",
                fontFamily: FONT_DISPLAY,
                fontSize: 13,
                letterSpacing: 2,
                fontWeight: 700,
                textTransform: "uppercase",
                cursor: "pointer",
                boxShadow: "0 12px 28px -8px rgba(184,137,74,0.55)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 16 }}>＋</span> Cobros rápidos
              {todayRevenue > 0 && (
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    letterSpacing: 0.5,
                    background: "rgba(255,253,248,0.25)",
                    padding: "2px 8px",
                    borderRadius: 999,
                  }}
                >
                  {fmt(todayRevenue)}
                </span>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {showLuggageModal && (
        <LuggageNewModal
          onCancel={() => setShowLuggageModal(false)}
          onCreated={onLuggageCreated}
        />
      )}
    </>
  );
}

function QuickChargeButton({
  label,
  price,
  count,
  busy,
  onClick,
}: {
  label: string;
  price: number;
  count: number;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        flex: 1,
        padding: "12px 10px",
        border: `1px solid ${C.gold}`,
        background: busy ? C.cream : C.paper,
        borderRadius: 12,
        cursor: busy ? "wait" : "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        transition: "transform 80ms ease",
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "scale(0.97)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <span
        style={{
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: 600,
          color: C.ink,
        }}
      >
        + {label}
      </span>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          color: C.gold,
          letterSpacing: 0.3,
        }}
      >
        {fmt(price)}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          color: C.mute,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        Hoy: {count}
      </span>
    </button>
  );
}
