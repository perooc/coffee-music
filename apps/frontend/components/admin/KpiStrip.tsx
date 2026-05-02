"use client";

/**
 * KPI strip — 4 métricas operacionales del header admin.
 *
 * Reemplaza la fila de 10 stat cards densa que se sentía abrumadora.
 * Cada card:
 *   - Caption Manrope mono-style en sand/mute (9px, letter-spacing 3px).
 *   - Valor Bebas Neue 28px, color semántico (olive=ok, gold=neutro,
 *     terracotta=alerta).
 *   - Animación de transición cuando el valor cambia: count-up para
 *     números, fade+y para strings (consumo formateado).
 *
 * Por qué framer-motion y no setInterval: queremos ver cambios solo
 * cuando el dato realmente cambia (vía socket), no en un tick fijo. El
 * `key` del `motion.span` se cambia con el valor → AnimatePresence hace
 * el cross-fade automáticamente.
 */

import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useRef } from "react";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  EASE_OUT_EXPO,
  DUR_BASE,
  DUR_SLOW,
} from "@/lib/theme";

export type KpiTone = "neutral" | "success" | "alert" | "warm";

const TONE_COLOR: Record<KpiTone, string> = {
  neutral: C.cacao,
  success: C.olive,
  alert: C.terracotta,
  warm: C.gold,
};

export interface Kpi {
  label: string;
  value: number | string;
  tone?: KpiTone;
  // Si el valor es un número formateado (ej. "$45.000"), pasa el número
  // crudo aquí para que el count-up se calcule sobre algo numérico, y
  // `format` para mostrar el resultado.
  numericValue?: number;
  format?: (n: number) => string;
}

export function KpiStrip({ kpis }: { kpis: Kpi[] }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 28,
        flexWrap: "wrap",
        alignItems: "stretch",
      }}
    >
      {kpis.map((kpi, i) => (
        <KpiCard key={kpi.label} kpi={kpi} index={i} />
      ))}
    </div>
  );
}

function KpiCard({ kpi, index }: { kpi: Kpi; index: number }) {
  const color = TONE_COLOR[kpi.tone ?? "neutral"];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DUR_SLOW / 1000,
        ease: [0.16, 1, 0.3, 1],
        delay: index * 0.04,
      }}
      style={{
        textAlign: "left",
        minWidth: 96,
        paddingRight: 12,
        borderRight: index < 3 ? `1px solid ${C.sand}` : "none",
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 2.4,
          color: C.mute,
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {kpi.label}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 28,
          color,
          letterSpacing: 0.5,
          lineHeight: 1,
        }}
      >
        {kpi.numericValue != null ? (
          <CountUp value={kpi.numericValue} format={kpi.format} />
        ) : (
          <FadeSwap value={kpi.value} />
        )}
      </div>
    </motion.div>
  );
}

/**
 * Anima el número desde el valor anterior hacia el nuevo en ~600ms,
 * usando easing `EASE_OUT_EXPO` (mismo que el resto del sistema).
 *
 * `useMotionValue` + `animate` evita re-renders durante el tween — el DOM
 * solo se toca a través del span (vía `useTransform`), no de React state.
 */
function CountUp({
  value,
  format,
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const mv = useMotionValue(value);
  const display = useTransform(mv, (n) =>
    format ? format(Math.round(n)) : String(Math.round(n)),
  );
  const prev = useRef(value);

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
    });
    prev.current = value;
    return controls.stop;
  }, [mv, value]);

  return <motion.span>{display}</motion.span>;
}

/**
 * Para valores que no son numéricos puros (ej. tiempos formateados).
 * Cross-fade del valor anterior al nuevo cuando cambia.
 */
function FadeSwap({ value }: { value: number | string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={String(value)}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: DUR_BASE / 1000, ease: [0.16, 1, 0.3, 1] }}
        style={{ display: "inline-block" }}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}
