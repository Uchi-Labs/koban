"use client";

import { animate, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import React from "react";
import {
  ChartArea,
  ChartContainer,
  ChartLine,
  ChartTooltip,
  type ChartConfig
} from "@/components/ui/charts";
import { Skeleton } from "@/components/ui/skeleton";
import { EASE_SMOOTH_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SpendingTrendPoint {
  label: string;
  spending: number;
}

interface SpendingChartPoint {
  isProjection?: boolean;
  label: string;
  projectionLabel?: string;
  projectedSpending?: number;
  spending?: number;
}

export interface NetWorthTrendPoint {
  label: string;
  value: number;
}

const compactCurrency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency"
});

// recharts' ResponsiveContainer measures its own box via ResizeObserver, which
// hasn't fired yet on first paint -- without a seed it reports width/height as
// -1 (a console warning on every mount) and re-renders once the real size
// lands. That extra settle pass widens the window during which the streamed
// page content and the client-hydrated tree can coexist in the DOM, which is
// exactly what trips the 390px "duplicate testid" e2e flake on narrow
// viewports. A conservative non-zero seed (matches the card's typical mobile
// width and the chart's fixed h-32 height) renders true dimensions on the
// first pass; the ResizeObserver still corrects it on real resize.
const CHART_INITIAL_DIMENSION = { width: 300, height: 128 };

const AreaChart = dynamic(() => import("recharts").then((module) => module.AreaChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((module) => module.CartesianGrid), { ssr: false });
const ReferenceLine = dynamic(() => import("recharts").then((module) => module.ReferenceLine), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((module) => module.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((module) => module.YAxis), { ssr: false });

export function MiniLineChart({
  budget,
  className,
  loading = false,
  projection,
  points
}: {
  budget: number;
  className?: string;
  loading?: boolean;
  points: SpendingTrendPoint[];
  projection?: {
    amount: number;
    label?: string;
  };
}) {
  const chartPoints = React.useMemo(() => {
    return createSpendingChartPoints(points, projection);
  }, [points, projection]);
  const lastSpending = points.at(-1)?.spending ?? 0;
  // This series is cumulative, so its raw slope is not a useful health signal.
  // Color the actual and projected paths by whether the month is on track.
  const spendingPositive = budget > 0
    ? (projection?.amount ?? lastSpending) <= budget
    : true;
  const projectionPositive = projection && budget > 0
    ? projection.amount <= budget
    : spendingPositive;
  const spendingConfig = {
    projectedSpending: {
      color: projectionPositive ? "var(--positive)" : "var(--negative)",
      label: "Projected month-end"
    },
    spending: {
      color: spendingPositive ? "var(--positive)" : "var(--negative)",
      label: "Actual spending"
    }
  } satisfies ChartConfig;

  if (loading) {
    return <Skeleton aria-label="Loading spending chart" className={cn("aspect-[3/1] w-full", className)} />;
  }

  return (
    <ChartContainer
      className={cn("min-h-0 aspect-[3/1] w-full", className)}
      config={spendingConfig}
      initialDimension={CHART_INITIAL_DIMENSION}
    >
      <AreaChart data={chartPoints} margin={{ bottom: 0, left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="spendingFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-spending)" stopOpacity={0.38} />
            <stop offset="0.58" stopColor="var(--color-spending)" stopOpacity={0.1} />
            <stop offset="1" stopColor="var(--color-spending)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="label"
          interval="preserveStartEnd"
          minTickGap={48}
          tick={{ fontSize: 11 }}
          tickLine={false}
          tickMargin={6}
        />
        <YAxis
          axisLine={false}
          tick={{ fontSize: 11 }}
          tickFormatter={(value: number) => compactCurrency.format(value)}
          tickLine={false}
          width={52}
        />
        <ChartTooltip
          content={<SpendingTooltipContent budget={budget} />}
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.4 }}
        />
        {budget > 0 ? (
          <ReferenceLine
            stroke="var(--muted-foreground)"
            strokeDasharray="4 6"
            strokeOpacity={0.5}
            y={budget}
          />
        ) : null}
        <ChartArea
          dataKey="spending"
          dot={false}
          fill="url(#spendingFill)"
          stroke="var(--color-spending)"
          strokeWidth={2}
          type="monotone"
        />
        {projection ? (
          <ChartLine
            connectNulls
            dataKey="projectedSpending"
            dot={false}
            isAnimationActive={false}
            stroke="var(--color-projectedSpending)"
            strokeDasharray="4 5"
            strokeLinecap="round"
            strokeWidth={1.75}
            type="monotone"
          />
        ) : null}
      </AreaChart>
    </ChartContainer>
  );
}

/*
 * Scrub-first portfolio chart (VytasBu reference):
 * - the readout lives in a fixed lane ABOVE the plot and rides the crosshair
 *   horizontally, so it never occludes the line;
 * - everything left of the crosshair keeps the colored line + fill ("the past"),
 *   everything right drops to a muted hairline ("the future");
 * - at rest the latest point carries a pulsing live dot;
 * - range switches blur-zoom (in for shorter ranges, out for longer).
 */
export function NetWorthChart({
  className,
  currency = "USD",
  label = "Net worth",
  points,
  positive,
  rangeIndex
}: {
  className?: string;
  currency?: string;
  label?: string;
  points: NetWorthTrendPoint[];
  positive: boolean;
  /** Position of the active range in the card's range order; drives zoom direction. */
  rangeIndex?: number;
}) {
  const reduce = useReducedMotion();
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const fillId = `nwFill${uid}`;
  const clipId = `nwClip${uid}`;
  const zoomRef = React.useRef<HTMLDivElement>(null);
  const prevRangeIndex = React.useRef(rangeIndex);
  const [scrub, setScrub] = React.useState<{ index: number; x: number } | null>(null);
  const scrubPoint = scrub ? points[scrub.index] : undefined;

  // Spec: rising net worth uses the primary token, decline uses red.
  const netWorthConfig = {
    value: {
      color: positive ? "var(--positive)" : "var(--negative)",
      label
    }
  } satisfies ChartConfig;

  React.useEffect(() => {
    const prev = prevRangeIndex.current;
    prevRangeIndex.current = rangeIndex;
    if (rangeIndex === undefined || prev === undefined || prev === rangeIndex || reduce || !zoomRef.current) {
      return;
    }
    // Shorter range = dive into the data; longer range = pull back out.
    const zoomIn = rangeIndex < prev;
    const controls = animate(
      zoomRef.current,
      {
        filter: ["blur(0px)", "blur(7px)", "blur(0px)"],
        opacity: [1, 0.75, 1],
        scale: [1, zoomIn ? 1.04 : 0.96, 1]
      },
      { duration: 0.45, ease: [...EASE_SMOOTH_OUT] }
    );
    return () => controls.stop();
  }, [rangeIndex, reduce]);

  const handleMouseMove = React.useCallback((state: unknown) => {
    const next = state as {
      activeCoordinate?: { x?: number };
      activeTooltipIndex?: number | string;
      isTooltipActive?: boolean;
    } | null;
    const rawIndex = next?.activeTooltipIndex;
    const index = typeof rawIndex === "string" ? Number(rawIndex) : rawIndex;
    if (next?.isTooltipActive && typeof next.activeCoordinate?.x === "number" && typeof index === "number" && Number.isFinite(index)) {
      setScrub({ index, x: next.activeCoordinate.x });
    } else {
      setScrub(null);
    }
  }, []);

  return (
    <div className={cn("flex min-h-0 w-full flex-col", className)}>
      {/* Fixed readout lane: value + date ride the crosshair, clamped to the plot. */}
      <div aria-hidden="true" className="relative h-5 shrink-0">
        {scrubPoint ? (
          <div
            className="absolute top-0 flex -translate-x-1/2 items-baseline gap-2.5 whitespace-nowrap"
            style={{ left: `clamp(5rem, ${scrub?.x ?? 0}px, calc(100% - 5rem))` }}
          >
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {scrubPoint.value.toLocaleString("en-US", { currency, style: "currency" })}
            </span>
            <span className="text-[11px] text-muted-foreground">{scrubPoint.label}</span>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1" ref={zoomRef}>
        <ChartContainer
          className="h-full min-h-0 w-full"
          config={netWorthConfig}
          initialDimension={CHART_INITIAL_DIMENSION}
        >
          <AreaChart
            data={points}
            margin={{ bottom: 0, left: 8, right: 0, top: 8 }}
            onMouseLeave={() => setScrub(null)}
            onMouseMove={handleMouseMove}
          >
            <defs>
              <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--color-value)" stopOpacity={0.34} />
                <stop offset="0.58" stopColor="var(--color-value)" stopOpacity={0.09} />
                <stop offset="1" stopColor="var(--color-value)" stopOpacity={0} />
              </linearGradient>
              <clipPath id={clipId}>
                <rect height="100%" width={scrub ? Math.max(0, scrub.x) : "100%"} x="0" y="0" />
              </clipPath>
            </defs>
            <XAxis
              axisLine={false}
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={48}
              // Inset the plot from the right so the endpoint dot clears the
              // Y-axis labels instead of crowding them.
              padding={{ left: 0, right: 12 }}
              tick={{ fontSize: 11 }}
              tickLine={false}
              tickMargin={6}
            />
            <YAxis
              axisLine={false}
              domain={["auto", "auto"]}
              orientation="right"
              tick={{ fontSize: 11 }}
              tickCount={4}
              tickFormatter={(value: number) => compactCurrency.format(value)}
              tickLine={false}
              width={52}
            />
            <ChartTooltip
              content={() => null}
              cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.3, strokeWidth: 1 }}
            />
            {/* Muted "future" line: always full-width, sits under the emphasis pass. */}
            <ChartArea
              activeDot={false}
              dataKey="value"
              dot={(props: { cx?: number; cy?: number; index?: number; key?: React.Key | null }) => {
                const { key, ...dotProps } = props;
                return (
                  <RestPulseDot
                    {...dotProps}
                    key={key ?? `rest-${props.index}`}
                    show={props.index === points.length - 1 && !scrub}
                  />
                );
              }}
              fill="transparent"
              isAnimationActive={false}
              stroke="color-mix(in oklab, var(--muted-foreground) 45%, transparent)"
              strokeWidth={1.5}
              type="monotone"
            />
            {/* Colored "past" pass: clipped to the crosshair while scrubbing. */}
            <ChartArea
              activeDot={{ fill: "var(--color-value)", r: 3.5, stroke: "var(--card)", strokeWidth: 1.5 }}
              dataKey="value"
              dot={false}
              fill={`url(#${fillId})`}
              stroke="var(--color-value)"
              strokeWidth={2}
              style={{
                clipPath: `url(#${clipId})`,
                filter: "drop-shadow(0 0 5px color-mix(in oklab, var(--color-value) 45%, transparent))"
              }}
              type="monotone"
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}

/* Rest-state live marker on the latest datum; the halo breathes unless
   prefers-reduced-motion. Rendered inside the recharts SVG tree. */
function RestPulseDot({ cx, cy, show }: { cx?: number; cy?: number; index?: number; show: boolean }) {
  const reduce = useReducedMotion();
  const haloRef = React.useRef<SVGCircleElement>(null);

  React.useEffect(() => {
    if (!show || reduce || !haloRef.current) {
      return;
    }
    const controls = animate(
      haloRef.current,
      { opacity: [0.45, 0], scale: [1, 2.4] },
      { duration: 1.8, ease: "easeOut", repeat: Infinity }
    );
    return () => controls.stop();
  }, [reduce, show]);

  if (!show || typeof cx !== "number" || typeof cy !== "number") {
    return <g />;
  }

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        fill="var(--color-value)"
        opacity={reduce ? 0.25 : 0.45}
        r={4.5}
        ref={haloRef}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle cx={cx} cy={cy} fill="var(--color-value)" r={3} stroke="var(--card)" strokeWidth={1} />
    </g>
  );
}

function createSpendingChartPoints(
  points: SpendingTrendPoint[],
  projection?: { amount: number; label?: string }
): SpendingChartPoint[] {
  if (!projection || points.length === 0) {
    return points;
  }

  const lastPoint = points.at(-1);
  if (!lastPoint) {
    return points;
  }

  return [
    ...points.map((point, index) => ({
      ...point,
      projectedSpending: index === points.length - 1 ? point.spending : undefined
    })),
    {
      isProjection: true,
      label: projection.label ?? "Projected",
      projectionLabel: projection.label ?? "Projected",
      projectedSpending: projection.amount
    }
  ];
}

interface SpendingTooltipPayloadItem {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  payload?: SpendingChartPoint;
  value?: unknown;
}

function SpendingTooltipContent({
  active,
  budget,
  label,
  payload
}: {
  active?: boolean;
  budget: number;
  label?: string;
  payload?: SpendingTooltipPayloadItem[];
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;
  const rows = payload
    .flatMap((item) => {
      const value = typeof item.value === "number" ? item.value : Number(item.value);
      const key = String(item.dataKey ?? "");

      if (!Number.isFinite(value)) {
        return [];
      }

      if (key === "projectedSpending" && !point?.isProjection) {
        return [];
      }

      return [
        {
          color: item.color ?? (key === "projectedSpending" ? "var(--negative)" : "var(--positive)"),
          label: key === "projectedSpending" ? (point?.projectionLabel ?? "Projected month-end") : "Actual spending",
          value
        }
      ];
    })
    .sort((left, right) => right.value - left.value);

  const primaryValue = rows[0]?.value;
  const budgetDelta = typeof primaryValue === "number" && budget > 0 ? budget - primaryValue : undefined;

  return (
    <div className="grid min-w-48 gap-2 rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-border">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        {point?.isProjection ? <span className="text-muted-foreground">Estimate</span> : null}
      </div>
      <div className="grid gap-1.5">
        {rows.map((row) => (
          <TooltipRow color={row.color} key={row.label} label={row.label} value={formatCurrency(row.value)} />
        ))}
        {budgetDelta !== undefined ? (
          <TooltipRow
            color={budgetDelta >= 0 ? "var(--positive)" : "var(--negative)"}
            label="Budget delta"
            value={`${budgetDelta >= 0 ? "" : "-"}${formatCurrency(Math.abs(budgetDelta))}`}
          />
        ) : null}
      </div>
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", { currency: "USD", style: "currency" });
}
