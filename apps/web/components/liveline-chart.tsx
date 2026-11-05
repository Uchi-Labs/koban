"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import React from "react";
import type { PortfolioPoint } from "@/lib/investments";
import { cn } from "@/lib/utils";

/**
 * A dependency-free SVG area/line chart for honest historical balance series.
 *
 * Why not the `liveline` package: it is a *real-time* streaming chart. It anchors
 * its visible window to the wall clock (`rightEdge = Date.now()/1e3 + window`,
 * default `window = 30s`) and drops any point outside that window before drawing
 * — see node_modules/liveline dist, the `if (visible.length < 2) return` guard.
 * Our snapshots carry real capture timestamps that are minutes-to-days old, so
 * every point fell outside the 30-second live window and the canvas stayed blank.
 *
 * This renders the actual `points` with a normalised viewBox that stretches to the
 * container (`preserveAspectRatio="none"` + `vector-effect="non-scaling-stroke"`),
 * so there is no ResizeObserver sizing race and no blank-until-measured frame.
 */

const V_PAD_TOP = 14;
const V_PAD_BOTTOM = 8;

export function LivelineChart({
  points,
  className,
  height = 160,
  sparkline = false,
  showValue = false,
  emptyText = "No snapshot history yet",
  colorVar
}: {
  points: PortfolioPoint[];
  className?: string;
  height?: number;
  sparkline?: boolean;
  showValue?: boolean;
  emptyText?: string;
  /** Override the trend colour (e.g. "--chart-1"). Defaults to semantic up/down. */
  colorVar?: string;
}) {
  const reduce = useReducedMotion();
  const gradientId = React.useId().replace(/:/g, "");
  const [active, setActive] = React.useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}
        style={{ height }}
      >
        {emptyText}
      </div>
    );
  }

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  const resolvedVar = colorVar ?? (delta < 0 ? "--negative" : "--positive");
  const color = `var(${resolvedVar})`;

  const values = points.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // Flat series — give it a hair of vertical room so the line sits mid-frame.
    const pad = Math.abs(min) * 0.02 || 1;
    min -= pad;
    max += pad;
  }
  const range = max - min;
  const usableH = 100 - V_PAD_TOP - V_PAD_BOTTOM;

  const coords = points.map((point, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = V_PAD_TOP + (1 - (point.value - min) / range) * usableH;
    return { x, y };
  });

  // A single snapshot is an honest flat line across the frame.
  if (points.length === 1) {
    coords.unshift({ x: 0, y: coords[0].y });
    coords.push({ x: 100, y: coords[0].y });
  }

  const linePath = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  const areaPath = `${linePath} L100 100 L0 100 Z`;
  const end = coords[coords.length - 1];

  // Hover crosshair is only meaningful once there are two or more real snapshots;
  // a single-point flat line has nothing to scrub across.
  const interactive = points.length >= 2;
  const activePoint = active !== null && active >= 0 && active < points.length ? points[active] : null;
  // For length >= 2 `coords` maps 1:1 to `points` (the single-point branch above,
  // which mutates coords, never runs when interactive is true).
  const activeCoord = active !== null && activePoint ? coords[active] : null;

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <div className="absolute inset-0 overflow-hidden">
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          fill="none"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <defs>
            <linearGradient id={`fill-${gradientId}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={sparkline ? 0.16 : 0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#fill-${gradientId})`} />
          {!sparkline ? (
            <line
              stroke="var(--border)"
              strokeDasharray="2 3"
              strokeOpacity={0.6}
              vectorEffect="non-scaling-stroke"
              x1="0"
              x2="100"
              y1={end.y}
              y2={end.y}
            />
          ) : null}
          {/* Opacity fade, not a pathLength draw-in: dasharray-based draw animations
              mis-render under non-scaling-stroke + preserveAspectRatio="none"
              (Chromium computes the dash pattern against rendered length), leaving
              permanent gaps in the line. */}
          <LazyMotion features={domAnimation}>
            <m.path
              animate={{ opacity: 1 }}
              d={linePath}
              initial={reduce ? { opacity: 1 } : { opacity: 0 }}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={sparkline ? 1.5 : 2}
              style={{ filter: sparkline ? undefined : `drop-shadow(0 0 4px color-mix(in oklab, ${color} 40%, transparent))` }}
              transition={{ duration: reduce ? 0 : 0.9, ease: "easeOut" }}
              vectorEffect="non-scaling-stroke"
            />
          </LazyMotion>
        </svg>

        {/* Endpoint marker — an HTML dot keeps a true circle under the stretched viewBox. */}
        {!sparkline && activeCoord === null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute"
            style={{ left: `${end.x}%`, top: `${end.y}%`, transform: "translate(-50%, -50%)" }}
          >
            {!reduce ? (
              <span
                className="absolute inset-0 rounded-full motion-safe:animate-ping"
                style={{ background: color, opacity: 0.35 }}
              />
            ) : null}
            <span className="relative block size-2 rounded-full ring-2 ring-background" style={{ background: color }} />
          </span>
        ) : null}

        {/* Hover crosshair: a vertical guide + a marker dot pinned to the nearest snapshot. */}
        {activeCoord ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-foreground/30"
              style={{ left: `${activeCoord.x}%` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute"
              style={{ left: `${activeCoord.x}%`, top: `${activeCoord.y}%`, transform: "translate(-50%, -50%)" }}
            >
              <span
                className={cn("block rounded-full ring-2 ring-background", sparkline ? "size-1.5" : "size-2")}
                style={{ background: color }}
              />
            </span>
          </>
        ) : null}
      </div>

      {showValue && !sparkline && activeCoord === null ? (
        <span
          className="pointer-events-none absolute right-1 top-1 rounded-md bg-background/70 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-muted-foreground ring-1 ring-border/60 backdrop-blur"
          style={{ color }}
        >
          {compactCurrency.format(last)}
        </span>
      ) : null}

      {/* Value + date readout. Kept inside the chart bounds and horizontally clamped
          so it never spills out of the (clipping) card that wraps a sparkline. */}
      {activeCoord && activePoint ? (
        <div
          className={cn(
            "pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-popover/95 text-popover-foreground shadow-md ring-1 ring-border backdrop-blur",
            sparkline ? "top-0 px-1.5 py-0.5 text-3xs" : "top-1 px-2 py-1 text-2xs"
          )}
          style={{
            left: `${activeCoord.x}%`,
            transform:
              activeCoord.x > 70 ? "translateX(-100%)" : activeCoord.x < 30 ? "translateX(0)" : "translateX(-50%)"
          }}
        >
          {sparkline ? (
            <span className="tabular-nums">
              <span className="text-muted-foreground">{sparkDateFormatter.format(activePoint.time * 1000)}</span>
              <span className="mx-1 text-muted-foreground/50">·</span>
              <span className="font-medium" style={{ color }}>
                {compactCurrency.format(activePoint.value)}
              </span>
            </span>
          ) : (
            <>
              <div className="text-2xs text-muted-foreground">
                {fullDateFormatter.format(activePoint.time * 1000)}
              </div>
              <div className="font-semibold tabular-nums" style={{ color }}>
                {fullCurrency.format(activePoint.value)}
              </div>
            </>
          )}
        </div>
      ) : null}

      {interactive ? (
        <div
          aria-hidden
          className="absolute inset-0 cursor-crosshair touch-none"
          onPointerDown={handlePointerMove}
          onPointerLeave={() => setActive(null)}
          onPointerMove={handlePointerMove}
        />
      ) : null}
    </div>
  );
}

const compactCurrency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
  style: "currency"
});

const fullCurrency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency"
});

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

const sparkDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short"
});
