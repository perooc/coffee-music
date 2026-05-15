"use client";

import { useEffect } from "react";

/**
 * Carga la consola de Eruda en el cliente cuando la URL tiene
 * `?debug=1`. Eruda es una consola de DevTools embebida que aparece
 * como botón flotante en pantallas táctiles — útil para inspeccionar
 * comportamiento en iPhone/Android sin cable USB ni Mac.
 *
 * Solo se carga bajo demanda y desde CDN, así que cero costo cuando
 * el flag no está activo. El script tarda ~1s en bajar.
 *
 * Uso: agregá `?debug=1` (o `&debug=1` si ya hay query string) al URL
 * en el celular. Cuando termines de diagnosticar, sacá el flag o
 * cerrá la pestaña — sessionStorage no persiste el modo.
 */
export function DebugConsole() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") !== "1") return;

    // Recordá si ya cargamos para evitar duplicación entre rerenders.
    if ((window as unknown as { __eruda_loaded?: boolean }).__eruda_loaded) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.async = true;
    script.onload = () => {
      const w = window as unknown as {
        eruda?: { init: () => void };
        __eruda_loaded?: boolean;
      };
      if (w.eruda) {
        w.eruda.init();
        w.__eruda_loaded = true;
      }
    };
    document.body.appendChild(script);
  }, []);

  return null;
}
