"use client";

import dynamic from "next/dynamic";
import React from "react";
import {
  ChartArea,
  ChartContainer,
  ChartLine,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from "@/components/ui/charts";
import { Skeleton } from "@/components/ui/skeleton";
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
    <ChartContainer className={cn("min-h-0 aspect-[3/1] w-full", className)} config={spendingConfig}>
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

export function NetWorthChart({
  className,
  points,
  positive
}: {
  className?: string;
  points: NetWorthTrendPoint[];
  positive: boolean;
}) {
  // Spec: rising net worth uses the primary token, decline uses red.
  const netWorthConfig = {
    value: {
      color: positive ? "var(--positive)" : "var(--negative)",
      label: "Net worth"
    }
  } satisfies ChartConfig;

  return (
    <ChartContainer className={cn("min-h-0 aspect-[3/1] w-full", className)} config={netWorthConfig}>
      <AreaChart data={points} margin={{ bottom: 0, left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="networthFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-value)" stopOpacity={0.34} />
            <stop offset="0.58" stopColor="var(--color-value)" stopOpacity={0.09} />
            <stop offset="1" stopColor="var(--color-value)" stopOpacity={0} />
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
          domain={["auto", "auto"]}
          tick={{ fontSize: 11 }}
          tickFormatter={(value: number) => compactCurrency.format(value)}
          tickLine={false}
          width={52}
        />
        <ChartTooltip
          content={<ChartTooltipContent formatter={tooltipCurrency} indicator="line" />}
          cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.4 }}
        />
        <ChartArea
          dataKey="value"
          dot={false}
          fill="url(#networthFill)"
          stroke="var(--color-value)"
          strokeWidth={2}
          style={{ filter: "drop-shadow(0 0 5px color-mix(in oklab, var(--color-value) 45%, transparent))" }}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
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

function tooltipCurrency(value: unknown, name: unknown) {
  const amount = typeof value === "number" ? value : Number(value);

  return (
    <span className="flex w-full items-center justify-between gap-3">
      <span className="text-muted-foreground">{String(name)}</span>
      <span className="font-medium tabular-nums">
        {Number.isFinite(amount)
          ? amount.toLocaleString("en-US", { currency: "USD", style: "currency" })
          : String(value)}
      </span>
    </span>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", { currency: "USD", style: "currency" });
}
