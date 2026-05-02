"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Marquee from "react-fast-marquee";

interface Props {
  text: string;
  className?: string;
}

/**
 * Renders a track title that auto-scrolls only when it overflows its
 * container. We measure the natural text width with a hidden span; if it
 * exceeds the visible width, we mount `react-fast-marquee` and hand the
 * same string to it. Otherwise we render the text statically with ellipsis
 * fallback so very narrow viewports still cap gracefully.
 *
 * Why measure ourselves instead of letting the marquee always run: a short
 * title sliding for no reason is visual noise, and on iOS Safari the
 * library briefly flickers on first paint when the content already fits.
 */
export function TrackTitleMarquee({ text, className }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  // useLayoutEffect on first mount so we never paint a flash of static
  // text before deciding to swap to marquee. The ResizeObserver below
  // keeps the decision live as the layout (rotation, panel width) shifts.
  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver(() => measure());
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  function measure() {
    const wrap = wrapRef.current;
    const probe = measureRef.current;
    if (!wrap || !probe) return;
    // Probe is absolute + invisible but kept in DOM so it inherits the same
    // font metrics as the live text. Add 1px slack to dodge sub-pixel
    // rounding noise that would re-trigger the marquee endlessly.
    setOverflowing(probe.scrollWidth - 1 > wrap.clientWidth);
  }

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ position: "relative", minWidth: 0 }}
    >
      <span
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          left: 0,
          top: 0,
        }}
      >
        {text}
      </span>
      {overflowing ? (
        <Marquee gradient={false} speed={32} pauseOnHover delay={1.2}>
          {/* Trailing spacer keeps a comfortable gap between loops. */}
          <span style={{ paddingRight: "3em" }}>{text}</span>
        </Marquee>
      ) : (
        <span
          className="mesa-npcard-title-static"
          style={{ display: "block", textAlign: "center" }}
        >
          {text}
        </span>
      )}
    </div>
  );
}
