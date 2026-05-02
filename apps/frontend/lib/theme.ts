/**
 * Shared visual language for customer-facing (`mesa/[id]`) and operator
 * (`admin`) surfaces. One file, one truth: paleta, tipografía, helpers
 * y keyframes que las dos vistas usan. No metas tokens locales en las
 * páginas — si un valor se repite, vive aquí.
 */
import type React from "react";

// ─── Warm premium palette ───────────────────────────────────────────────────
//
// Semantics (úsalo así, no por color):
//   - gold        → identidad principal, énfasis, CTAs hero.
//   - terracotta  → urgencia, alertas, "ocupado", cancelar/rechazar.
//   - olive       → SOLO confirmaciones positivas (success, listo, entregado,
//                   reproduciendo). No usar como tono decorativo.
//   - cacao/ink   → texto/headings.
//   - mute        → texto secundario, captions.
//   - cream/paper → fondos.
//   - sand        → bordes, separadores.
export const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
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
  paper: "#FFFDF8",
  shadow:
    "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
  shadowLift:
    "0 2px 0 rgba(43,29,20,0.05), 0 22px 40px -18px rgba(184,137,74,0.55)",
  shadowModal:
    "0 30px 80px -20px rgba(43,29,20,0.45), 0 10px 32px -12px rgba(107,78,46,0.35)",
} as const;

// ─── Three-tier font system ─────────────────────────────────────────────────
//   FONT_HEADING — Old English / blackletter. Solo para identidad marquee:
//     "Mesa 07", scoreboard total, títulos hero. Nunca por debajo de 22px,
//     nunca con letter-spacing > 0 (los glifos ya respiran).
//   FONT_DISPLAY — Bebas Neue (condensed). CTAs, tabs, botones, eyebrows.
//   FONT_UI      — Manrope. Cuerpo, listas, descripciones, items.
//   FONT_MONO    — alias de Manrope. Caption/badges/hints. Antes era Oswald
//     pero a 10px era ilegible. Mantenemos el nombre por compatibilidad
//     semántica en call-sites (donde "MONO" significa "tipografía técnica
//     pequeña con letter-spacing"), pero apunta al mismo Manrope. El peso
//     y el spacing por call-site marcan el ritmo visual.
export const FONT_HEADING =
  "var(--font-blackletter), 'UnifrakturCook', 'Old English Text MT', serif";
export const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
export const FONT_UI = "var(--font-manrope), system-ui, sans-serif";
export const FONT_MONO = "var(--font-manrope), system-ui, sans-serif";

// ─── Motion ─────────────────────────────────────────────────────────────────
// Tirado del marquee de mesa: misma curva que `mesa-toast-in` y todas las
// transiciones de entrada. Mantén estos valores acoplados — si los cambias,
// las dos vistas deben sentir lo mismo.
export const EASE_OUT_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";
export const DUR_FAST = 160;
export const DUR_BASE = 220;
export const DUR_SLOW = 420;

// ─── Helpers ────────────────────────────────────────────────────────────────
export const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export const pad = (n: number) => String(n).padStart(2, "0");
export const secToMin = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

export function fmtTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Shared keyframes ───────────────────────────────────────────────────────
// String CSS para inyectar en una <style> tag. Cada vista lo concatena con
// sus reglas propias. No es un componente — es un fragmento de CSS bruto
// para que las páginas mantengan control sobre su <style>{...}</style>.
export const SHARED_KEYFRAMES = `
  @keyframes crown-ping {
    0%   { transform: scale(1);   opacity: 0.55; }
    80%  { transform: scale(2.6); opacity: 0;    }
    100% { transform: scale(2.6); opacity: 0;    }
  }
  @keyframes crown-tab-in {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  @keyframes crown-eq-1 {
    0%, 100% { transform: scaleY(0.3); }
    50%      { transform: scaleY(1);   }
  }
  @keyframes crown-eq-2 {
    0%, 100% { transform: scaleY(0.55); }
    50%      { transform: scaleY(0.2);  }
  }
  @keyframes crown-eq-3 {
    0%, 100% { transform: scaleY(0.8);  }
    50%      { transform: scaleY(0.35); }
  }
  @keyframes crown-vinyl-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes crown-sweep {
    0%   { transform: translateX(-120%); }
    100% { transform: translateX(220%);  }
  }
  @keyframes crown-toast-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  /* Pulsa el borde de las mesas que piden atención. Es la versión "anillo
     sobre tarjeta" del crown-ping clásico (que es para dots redondos). */
  @keyframes crown-cell-ping {
    0%   { box-shadow: 0 0 0 0   rgba(139,38,53,0.45); }
    70%  { box-shadow: 0 0 0 10px rgba(139,38,53,0);   }
    100% { box-shadow: 0 0 0 0   rgba(139,38,53,0);    }
  }
  /* Indicador lateral en cards "frescas" (recién llegadas a la columna).
     Modula la opacidad del span lateral para llamar la atención sin
     mover layout. Se desactiva solo cuando isRecent() retorna false. */
  @keyframes crown-fresh-pulse {
    0%, 100% { opacity: 1;    }
    50%      { opacity: 0.45; }
  }
  /* Shimmer para skeletons mientras se cargan datos. Anima el
     background-position de un gradient horizontal — sutil pero le da
     al loading state textura de "esto está pasando". */
  @keyframes crown-skeleton-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

// ─── Button system ──────────────────────────────────────────────────────────
//
// Jerarquía de tres niveles para que el operador del admin distinga acciones
// a un metro y medio de distancia durante el servicio:
//
//   HERO     — Bebas Neue, fondo gradient lleno. Solo CTAs grandes (≥14px),
//              uno por sección. Ej: "+ AGREGAR", "PEDIR CANCIÓN".
//
//   PRIMARY  — Manrope 800, fondo lleno (color sólido), texto paper.
//              Acciones positivas dentro de cards. Tamaño chico-medio
//              (11-12px) donde Bebas se ve frágil. Ej: "ENTREGAR",
//              "ACEPTAR".
//
//   GHOST    — Manrope 700, fondo transparent, borde + texto en color
//              semántico. Acciones secundarias / destructivas. El usuario
//              tiene que mirarlo a propósito para clickear. Ej: "RECHAZAR",
//              "CANCELAR".
//
// Por qué Manrope 800 y no Bebas en card actions: Bebas no tiene pesos —
// a 11px es estructuralmente fina y "vibra" sobre fondos llenos. Manrope
// 800 a ese tamaño tiene 3× el peso óptico y se lee de un vistazo.
//
// Los call-sites pasan `bg`/`fg`/`border` para variar el color sin clonar
// estructura. Ej: btnPrimary({ bg: C.gold, fg: C.paper }).

const BTN_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  transition: `transform ${DUR_FAST}ms ${EASE_OUT_EXPO}, box-shadow ${DUR_FAST}ms ${EASE_OUT_EXPO}, background ${DUR_FAST}ms ${EASE_OUT_EXPO}`,
};

export function btnHero(opts: {
  bg: string;
  fg: string;
  size?: "sm" | "md";
}): React.CSSProperties {
  const sm = opts.size === "sm";
  return {
    ...BTN_BASE,
    padding: sm ? "9px 14px" : "12px 18px",
    fontFamily: FONT_DISPLAY,
    fontSize: sm ? 12 : 14,
    letterSpacing: sm ? 2.5 : 3,
    fontWeight: 600,
    border: "none",
    background: opts.bg,
    color: opts.fg,
    boxShadow: C.shadow,
  };
}

export function btnPrimary(opts: {
  bg: string;
  fg: string;
  fullWidth?: boolean;
}): React.CSSProperties {
  return {
    ...BTN_BASE,
    flex: opts.fullWidth ? 1 : undefined,
    padding: "9px 16px",
    fontFamily: FONT_UI,
    fontSize: 12,
    letterSpacing: 0.4,
    fontWeight: 800,
    textTransform: "uppercase",
    border: "none",
    background: opts.bg,
    color: opts.fg,
    boxShadow: `0 1px 0 rgba(43,29,20,0.06), 0 6px 14px -8px ${opts.bg}`,
  };
}

export function btnGhost(opts: {
  fg: string;
  border?: string;
}): React.CSSProperties {
  return {
    ...BTN_BASE,
    padding: "9px 14px",
    fontFamily: FONT_UI,
    fontSize: 11.5,
    letterSpacing: 0.4,
    fontWeight: 700,
    textTransform: "uppercase",
    background: "transparent",
    color: opts.fg,
    border: `1px solid ${opts.border ?? opts.fg}`,
  };
}

// ─── Button hover styles ────────────────────────────────────────────────────
//
// CSS-in-JS no soporta `:hover` en `style={}`. Para que los botones reaccionen
// al cursor sin clonar JSX, exportamos un fragmento CSS que las páginas
// inyectan una sola vez vía `<style>{BUTTON_STYLES}</style>`. Los call-sites
// solo añaden `className="crown-btn"` (o las variantes `crown-btn-hero` /
// `crown-btn-primary` / `crown-btn-ghost`) y heredan hover/active/disabled.
//
// El hover usa transform + box-shadow porque cambiar fondo en gradient lleno
// rompe el degradado durante la transición.
export const BUTTON_STYLES = `
  .crown-btn {
    transition:
      transform ${DUR_FAST}ms ${EASE_OUT_EXPO},
      box-shadow ${DUR_FAST}ms ${EASE_OUT_EXPO},
      filter   ${DUR_FAST}ms ${EASE_OUT_EXPO};
    will-change: transform;
  }
  .crown-btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .crown-btn:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }
  .crown-btn:disabled {
    cursor: not-allowed;
    filter: saturate(0.6);
  }
  .crown-btn:focus-visible {
    outline: 2px solid ${C.gold};
    outline-offset: 2px;
  }

  /* Hero — fondo lleno con gradient. Se realza con sombra, no con fondo. */
  .crown-btn-hero:hover:not(:disabled) {
    box-shadow:
      0 2px 0 rgba(43,29,20,0.06),
      0 16px 28px -10px rgba(184,137,74,0.55);
  }

  /* Primary — fondo color sólido. Se realza con un brillo sutil + lift. */
  .crown-btn-primary:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow:
      0 2px 0 rgba(43,29,20,0.08),
      0 12px 22px -10px rgba(43,29,20,0.35);
  }

  /* Ghost — sin fondo. En hover se rellena suave con el color del borde.
     !important porque los call-sites pasan background/color/border vía
     style={} inline (necesario para variantes de color), y los inline
     styles ganan a CSS por especificidad. */
  .crown-btn-ghost:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 12%, transparent) !important;
  }

  /* Ghost danger — para acciones destructivas (Salir, Rechazar, Cancelar).
     Hover llena con terracotta sólido + texto paper para que el click se
     sienta consecuente. Mismo motivo del !important arriba. */
  .crown-btn-ghost-danger:hover:not(:disabled) {
    background: ${C.terracotta} !important;
    color: ${C.paper} !important;
    border-color: ${C.terracotta} !important;
  }
`;

// ─── CSS custom properties ──────────────────────────────────────────────────
// Block reusable para que cualquier root inyecte las variables `--c-*`
// sin duplicar la lista. Úsalo como prefijo de un selector raíz:
//   `.mi-root { ${THEME_CSS_VARS} ... }`
export const THEME_CSS_VARS = `
  --c-cream: ${C.cream};
  --c-parchment: ${C.parchment};
  --c-sand: ${C.sand};
  --c-sand-dark: ${C.sandDark};
  --c-gold: ${C.gold};
  --c-gold-soft: ${C.goldSoft};
  --c-terracotta: ${C.terracotta};
  --c-terracotta-soft: ${C.terracottaSoft};
  --c-olive: ${C.olive};
  --c-olive-soft: ${C.oliveSoft};
  --c-cacao: ${C.cacao};
  --c-ink: ${C.ink};
  --c-mute: ${C.mute};
  --c-paper: ${C.paper};
`;
