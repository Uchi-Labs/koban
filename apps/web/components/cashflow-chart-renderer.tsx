"use client";

import { useReducedMotion } from "motion/react";
import React from "react";
import { BarChart, CartesianGrid, Cell, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartBar, ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/charts";
import { formatMonthLong } from "@/lib/cashflow";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export type CashflowChartVariant = "net" | "spend" | "income";

export interface CashflowChartCategory {
  id: string;
  name: string;
  color: string;
}

export interface CashflowChartRow {
  month: string;
  monthLabel: string;
  isFuture: boolean;
  net: number;
  income: number;
  spend: number;
  comparisonNet: number;
  comparisonIncome: number;
  comparisonSpend: number;
  [categoryValue: string]: number | string | boolean;
}

const compactCurrency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency"
});

export interface CashflowChartProps {
  variant: CashflowChartVariant;
  data: CashflowChartRow[];
  categories?: CashflowChartCategory[];
  currency: string;
  nowMonthLabel: string | null;
  className?: string;
}

const EMPTY_CATEGORIES: CashflowChartCategory[] = [];

// recharts writes `fill`/`stroke` as SVG presentation *attributes*, and browsers
// do NOT resolve CSS `var(--token)` inside SVG attributes — they fall back to
// black. (Inline styles on HTML nodes, like the tooltip swatches, resolve fine;
// the stacked spend bars work because they already receive a concrete
// `category.color`.) So the SVG-facing chart colors must be resolved to concrete
// strings via getComputedStyle before they reach recharts.
const CHART_COLOR_VARS = {
  grid: "--border",
  income: "--chart-1",
  muted: "--muted-foreground",
  negative: "--negative",
  popover: "--popover",
  positive: "--positive"
} as const;

type ResolvedChartColors = Record<keyof typeof CHART_COLOR_VARS, string>;

// Ink & Mint dark-default fallbacks — only used for the very first paint before
// the effect resolves the live tokens (and if a token is ever missing).
const FALLBACK_CHART_COLORS: ResolvedChartColors = {
  grid: "oklch(0.94 0.01 230 / 9%)",
  income: "oklch(0.72 0.13 235)",
  muted: "oklch(0.74 0.012 245)",
  negative: "oklch(0.73 0.16 15)",
  popover: "oklch(0.19 0.009 250)",
  positive: "oklch(0.8 0.15 165)"
};

function useResolvedChartColors(): ResolvedChartColors {
  const [colors, setColors] = React.useState<ResolvedChartColors>(FALLBACK_CHART_COLORS);

  React.useEffect(() => {
    const root = document.documentElement;

    const resolve = () => {
      const style = getComputedStyle(root);
      const next = {} as ResolvedChartColors;
      for (const key of Object.keys(CHART_COLOR_VARS) as Array<keyof typeof CHART_COLOR_VARS>) {
        const value = style.getPropertyValue(CHART_COLOR_VARS[key]).trim();
        next[key] = value || FALLBACK_CHART_COLORS[key];
      }
      setColors((current) =>
        (Object.keys(next) as Array<keyof typeof CHART_COLOR_VARS>).every((key) => current[key] === next[key])
          ? current
          : next
      );
    };

    resolve();

    // Re-resolve when a theme toggle flips class/data-theme on <html>.
    const observer = new MutationObserver(() => resolve());
    observer.observe(root, { attributeFilter: ["class", "data-theme", "style"], attributes: true });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export function CashflowChartRenderer({
  variant,
  data,
  categories = EMPTY_CATEGORIES,
  currency,
  nowMonthLabel,
  className
}: CashflowChartProps) {
  const reduce = useReducedMotion();
  const colors = useResolvedChartColors();

  const config = React.useMemo<ChartConfig>(() => {
    const base: ChartConfig = {
      net: { color: "var(--positive)", label: "Net" },
      income: { color: "var(--chart-1)", label: "Income" },
      spend: { color: "var(--negative)", label: "Spend" }
    };
    for (const category of categories) {
      base[category.id] = { color: category.color, label: category.name };
    }
    return base;
  }, [categories]);

  const comparisonKey =
    variant === "net" ? "comparisonNet" : variant === "income" ? "comparisonIncome" : "comparisonSpend";
  const hasComparison = data.some((row) => Math.abs(row[comparisonKey] as number) > 0.005);

  return (
    <ChartContainer className={cn("aspect-[16/7] w-full", className)} config={config}>
      <BarChart data={data} margin={{ bottom: 0, left: 4, right: 8, top: 18 }}>
        <CartesianGrid stroke={colors.grid} strokeOpacity={0.6} vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="monthLabel"
          interval="preserveStartEnd"
          minTickGap={variant === "net" ? 12 : 120}
          tick={{ fontSize: 11 }}
          tickLine={false}
          tickMargin={8}
        />
        <YAxis
          axisLine={false}
          tick={{ fontSize: 11 }}
          tickFormatter={(value: number) => compactCurrency.format(value)}
          tickLine={false}
          width={48}
        />
        <ChartTooltip
          content={<CashflowTooltip categories={categories} currency={currency} variant={variant} />}
          cursor={{ fill: colors.muted, fillOpacity: 0.08 }}
        />
        <ReferenceLine stroke={colors.grid} strokeOpacity={0.9} y={0} />

        {variant === "net" ? (
          <ChartBar dataKey="net" isAnimationActive={!reduce} maxBarSize={26} radius={[3, 3, 0, 0]}>
            {data.map((row) => (
              <Cell
                fill={row.net >= 0 ? colors.positive : colors.negative}
                fillOpacity={row.isFuture ? 0.25 : 1}
                key={row.month}
              />
            ))}
          </ChartBar>
        ) : null}

        {variant === "income" ? (
          <ChartBar dataKey="income" isAnimationActive={!reduce} maxBarSize={26} radius={[3, 3, 0, 0]}>
            {data.map((row) => (
              <Cell fill={colors.income} fillOpacity={row.isFuture ? 0.25 : 1} key={row.month} />
            ))}
          </ChartBar>
        ) : null}

        {variant === "spend"
          ? categories.map((category, index) => (
              <ChartBar
                dataKey={category.id}
                fill={category.color}
                isAnimationActive={!reduce}
                key={category.id}
                maxBarSize={26}
                radius={index === categories.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                seriesIndex={index}
                stackId="spend"
              />
            ))
          : null}

        {hasComparison ? (
          <Line
            connectNulls
            dataKey={comparisonKey}
            dot={false}
            isAnimationActive={false}
            stroke={colors.muted}
            strokeDasharray="4 5"
            strokeLinecap="round"
            strokeOpacity={0.55}
            strokeWidth={1.5}
            type="monotone"
          />
        ) : null}

        {nowMonthLabel ? <ReferenceLine label={<NowLabel colors={colors} />} stroke={colors.muted} strokeDasharray="2 3" strokeOpacity={0.4} x={nowMonthLabel} /> : null}
      </BarChart>
    </ChartContainer>
  );
}

function NowLabel(props: { colors?: ResolvedChartColors; viewBox?: { x?: number; y?: number } }) {
  const x = props.viewBox?.x ?? 0;
  const y = props.viewBox?.y ?? 0;
  const colors = props.colors ?? FALLBACK_CHART_COLORS;
  const width = 34;
  const height = 16;

  return (
    <g transform={`translate(${x - width / 2}, ${Math.max(2, y - height - 2)})`}>
      <rect fill={colors.popover} height={height} rx={5} stroke={colors.grid} width={width} x={0} y={0} />
      <text
        dominantBaseline="central"
        fill={colors.muted}
        fontSize={10}
        fontWeight={500}
        textAnchor="middle"
        x={width / 2}
        y={height / 2 + 0.5}
      >
        Now
      </text>
    </g>
  );
}

interface TooltipPayloadItem {
  color?: string;
  dataKey?: string | number;
  value?: number | string;
  payload?: CashflowChartRow;
}

function CashflowTooltip({
  active,
  categories,
  currency,
  payload,
  variant
}: {
  active?: boolean;
  categories: CashflowChartCategory[];
  currency: string;
  payload?: TooltipPayloadItem[];
  variant: CashflowChartVariant;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0]?.payload;
  if (!row) {
    return null;
  }

  const rows: Array<{ color: string; label: string; value: number }> = [];

  if (variant === "net") {
    rows.push({ color: row.net >= 0 ? "var(--positive)" : "var(--negative)", label: "Net", value: row.net });
  } else if (variant === "income") {
    rows.push({ color: "var(--chart-1)", label: "Income", value: row.income });
  } else {
    for (const category of categories) {
      const value = Number(row[category.id] ?? 0);
      if (value > 0.005) {
        rows.push({ color: category.color, label: category.name, value });
      }
    }
    rows.sort((left, right) => right.value - left.value);
  }

  const comparisonValue =
    variant === "net" ? row.comparisonNet : variant === "income" ? row.comparisonIncome : row.comparisonSpend;
  const totalValue = variant === "spend" ? row.spend : rows[0]?.value ?? 0;

  return (
    <div className="grid min-w-44 gap-2 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{formatMonthLong(row.month)}</span>
        {variant === "spend" ? (
          <span className="font-medium tabular-nums text-foreground">{formatCurrency(totalValue, currency)}</span>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        {rows.slice(0, 8).map((item) => (
          <div className="flex items-center justify-between gap-4" key={item.label}>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-[3px]" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="font-medium tabular-nums text-foreground">{formatCurrency(item.value, currency)}</span>
          </div>
        ))}
        {rows.length === 0 ? <span className="text-muted-foreground">No activity</span> : null}
        {Math.abs(comparisonValue) > 0.005 ? (
          <div className="mt-0.5 flex items-center justify-between gap-4 border-t border-border pt-1.5">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden="true" className="h-0 w-3 shrink-0 border-t-[1.5px] border-dashed border-muted-foreground" />
              <span>Comparison</span>
            </span>
            <span className="font-medium tabular-nums text-muted-foreground">{formatCurrency(comparisonValue, currency)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
