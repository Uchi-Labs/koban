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

  return (
    <div className={cn("relative w-full overflow-hidden", className)} style={{ height }}>
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
      {!sparkline ? (
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

      {showValue && !sparkline ? (
        <span
          className="pointer-events-none absolute right-1 top-1 rounded-md bg-background/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border/60 backdrop-blur"
          style={{ color }}
        >
          {compactCurrency.format(last)}
        </span>
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
