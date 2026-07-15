"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import React from "react";
import {
  CashflowChart,
  type CashflowChartCategory,
  type CashflowChartRow,
  type CashflowChartVariant
} from "@/components/cashflow-chart";
import { EmptyState } from "@/components/ui/card";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { RollingDigits } from "@/components/ui/rolling-digits";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ROLLING_DIGITS_HERO } from "@/lib/motion";
import {
  buildMonthlySeries,
  comparisonOffsetMonths,
  computeDelta,
  computeTotals,
  formatMonthTick,
  formatRangeLabel,
  resolveChartMonths,
  resolveComparisonRange,
  resolvePeriodRange,
  topSpendCategoryIds,
  type CashflowTxn,
  type ComparisonMode,
  type Delta,
  type PeriodPreset
} from "@/lib/cashflow";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CashflowCategoryMeta {
  id: string;
  name: string;
  color: string;
}

const OTHER_CATEGORY: CashflowChartCategory = {
  color: "var(--muted-foreground)",
  id: "__other",
  name: "Other"
};

const PERIOD_OPTIONS: Array<{ label: string; value: PeriodPreset }> = [
  { label: "Year to date", value: "ytd" },
  { label: "Last 12 months", value: "last_12_months" },
  { label: "This month", value: "this_month" },
  { label: "Last month", value: "last_month" }
];

const COMPARISON_OPTIONS: Array<{ label: string; value: ComparisonMode }> = [
  { label: "Previous period", value: "previous_period" },
  { label: "Previous year", value: "previous_year" }
];

export function CashflowView({
  categories,
  currency,
  reference,
  transactions
}: {
  categories: CashflowCategoryMeta[];
  currency: string;
  reference: string;
  transactions: CashflowTxn[];
}) {
  const [period, setPeriod] = React.useState<PeriodPreset>("ytd");
  const [comparison, setComparison] = React.useState<ComparisonMode>("previous_period");
  const [includeExcluded, setIncludeExcluded] = React.useState(false);

  const categoryMap = React.useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const model = React.useMemo(() => {
    const range = resolvePeriodRange(period, reference);
    const offset = comparisonOffsetMonths(period, comparison);
    const comparisonRange = resolveComparisonRange(range, offset);
    const totals = computeTotals(transactions, range, includeExcluded);
    const comparisonTotals = computeTotals(transactions, comparisonRange, includeExcluded);
    const months = resolveChartMonths(period, reference);
    const referenceMonth = reference.slice(0, 7);
    const series = buildMonthlySeries({
      comparisonOffsetMonths: offset,
      includeExcluded,
      months,
      referenceMonth,
      txns: transactions
    });

    const stackIds = topSpendCategoryIds(series, 8);
    const stackIdSet = new Set(stackIds);
    const stackCategories: CashflowChartCategory[] = stackIds.map((id) => {
      const meta = categoryMap.get(id);
      return { color: meta?.color ?? "var(--muted-foreground)", id, name: meta?.name ?? "Uncategorized" };
    });

    let hasOther = false;
    const rows: CashflowChartRow[] = series.map((point) => {
      const row: CashflowChartRow = {
        comparisonIncome: point.comparisonIncome,
        comparisonNet: point.comparisonNet,
        comparisonSpend: point.comparisonSpend,
        income: point.income,
        isFuture: point.isFuture,
        month: point.month,
        monthLabel: formatMonthTick(point.month),
        net: point.net,
        spend: point.spend
      };

      let otherSpend = 0;
      for (const [categoryId, value] of Object.entries(point.spendByCategory)) {
        if (stackIdSet.has(categoryId)) {
          row[categoryId] = value;
        } else {
          otherSpend += value;
        }
      }
      for (const id of stackIds) {
        if (row[id] === undefined) {
          row[id] = 0;
        }
      }
      if (otherSpend > 0.005) {
        hasOther = true;
      }
      row[OTHER_CATEGORY.id] = Math.round(otherSpend * 100) / 100;
      return row;
    });

    const chartCategories = hasOther ? [...stackCategories, OTHER_CATEGORY] : stackCategories;
    const nowMonthLabel = months.includes(referenceMonth) ? formatMonthTick(referenceMonth) : null;

    return {
      chartCategories,
      comparisonRange,
      comparisonTotals,
      nowMonthLabel,
      range,
      rows,
      totals
    };
  }, [categoryMap, comparison, includeExcluded, period, reference, transactions]);

  const rangeLabel = formatRangeLabel(model.range);
  const comparisonRangeLabel = formatRangeLabel(model.comparisonRange);
  const periodLabel = PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? "Year to date";

  const netDelta = computeDelta(model.totals.net, model.comparisonTotals.net);
  const spendDelta = computeDelta(model.totals.spend, model.comparisonTotals.spend);
  const incomeDelta = computeDelta(model.totals.income, model.comparisonTotals.income);

  const isEmpty = transactions.length === 0;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 lg:px-8" data-testid="cashflow-page">
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="app-page-title">Cash flow</h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Select onValueChange={(value) => setPeriod(value as PeriodPreset)} value={period}>
            <SelectTrigger aria-label="Select period" className="rounded-2xl" size="sm">
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-foreground">{periodLabel}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground tabular-nums">{rangeLabel}</span>
              </span>
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-sm text-muted-foreground">compared to</span>

          <Select onValueChange={(value) => setComparison(value as ComparisonMode)} value={comparison}>
            <SelectTrigger aria-label="Select comparison period" className="rounded-2xl" size="sm">
              <span className="font-medium text-foreground">
                {COMPARISON_OPTIONS.find((option) => option.value === comparison)?.label}
              </span>
            </SelectTrigger>
            <SelectContent>
              {COMPARISON_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label
          className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
          htmlFor="cashflow-include-excluded"
        >
          <span>Show excluded spend</span>
          <Switch
            aria-label="Show excluded spend"
            checked={includeExcluded}
            id="cashflow-include-excluded"
            onCheckedChange={(checked) => setIncludeExcluded(checked === true)}
          />
        </label>
      </header>

      {isEmpty ? (
        <EmptyState
          description="Sync a Teller connection or import historical transactions to see your monthly income, spend, and net cash flow."
          title="No cash flow yet"
        />
      ) : (
        <div className="grid gap-4">
          <CashflowCard
            categories={model.chartCategories}
            currency={currency}
            delta={netDelta}
            deltaMetric="net"
            figure={model.totals.net}
            figureTone={model.totals.net >= 0 ? "positive" : "negative"}
            nowMonthLabel={model.nowMonthLabel}
            rangeLabel={rangeLabel}
            comparisonRangeLabel={comparisonRangeLabel}
            rows={model.rows}
            title="Net income"
            variant="net"
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <CashflowCard
              categories={model.chartCategories}
              currency={currency}
              delta={spendDelta}
              deltaMetric="spend"
              figure={model.totals.spend}
              figureTone="neutral"
              nowMonthLabel={model.nowMonthLabel}
              rangeLabel={rangeLabel}
              comparisonRangeLabel={comparisonRangeLabel}
              rows={model.rows}
              title="Spend"
              variant="spend"
            />
            <CashflowCard
              categories={model.chartCategories}
              currency={currency}
              delta={incomeDelta}
              deltaMetric="income"
              figure={model.totals.income}
              figureTone="positive"
              nowMonthLabel={model.nowMonthLabel}
              rangeLabel={rangeLabel}
              comparisonRangeLabel={comparisonRangeLabel}
              rows={model.rows}
              title="Income"
              variant="income"
            />
          </div>
        </div>
      )}
    </main>
  );
}

function CashflowCard({
  categories,
  comparisonRangeLabel,
  currency,
  delta,
  deltaMetric,
  figure,
  figureTone,
  nowMonthLabel,
  rangeLabel,
  rows,
  title,
  variant
}: {
  categories: CashflowChartCategory[];
  comparisonRangeLabel: string;
  currency: string;
  delta: Delta;
  deltaMetric: "net" | "spend" | "income";
  figure: number;
  figureTone: "positive" | "negative" | "neutral";
  nowMonthLabel: string | null;
  rangeLabel: string;
  rows: CashflowChartRow[];
  title: string;
  variant: CashflowChartVariant;
}) {
  const figureColor =
    figureTone === "positive"
      ? "text-[var(--positive)]"
      : figureTone === "negative"
        ? "text-[var(--negative)]"
        : "text-foreground";
  const currencySymbol = currency === "USD" ? "$" : `${currency} `;
  const figureNegative = figure < 0;

  return (
    <IconiqCard className="gap-4 rounded-xl border-border/60 bg-card/95 py-4 shadow-[var(--ic-card-rest-shadow)]" interactive>
      <IconiqCardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{rangeLabel}</p>
        </div>
        <Link
          className="inline-flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
          href="/transactions"
        >
          View more
          <ArrowUpRight className="size-3.5" />
        </Link>
      </IconiqCardContent>

      <IconiqCardContent className="flex flex-col gap-1.5">
        <span className={cn("inline-flex items-baseline text-3xl font-semibold tabular-nums", figureColor)}>
          {figureNegative ? "−" : ""}
          {currencySymbol}
          <RollingDigits
            animationDelay={ROLLING_DIGITS_HERO.animationDelay}
            coalesceUpdates
            direction="dynamic"
            enterDamping={ROLLING_DIGITS_HERO.enterDamping}
            enterStiffness={ROLLING_DIGITS_HERO.enterStiffness}
            enterY={ROLLING_DIGITS_HERO.enterY}
            format={(value) => Math.round(Math.abs(value)).toLocaleString("en-US")}
            gap={0}
            startOnView={false}
            value={figure}
          />
        </span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <DeltaPill delta={delta} metric={deltaMetric} />
          <span className="text-muted-foreground">
            vs <span className="font-medium tabular-nums text-foreground/80">{formatCurrency(delta.previous, currency)}</span> in{" "}
            <span className="tabular-nums">{comparisonRangeLabel}</span>
          </span>
        </div>
      </IconiqCardContent>

      <CashflowChart
        categories={categories}
        className="px-1"
        currency={currency}
        data={rows}
        nowMonthLabel={nowMonthLabel}
        variant={variant}
      />
    </IconiqCard>
  );
}

function DeltaPill({ delta, metric }: { delta: Delta; metric: "net" | "spend" | "income" }) {
  if (delta.pct === null || delta.direction === "flat") {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
        No change
      </span>
    );
  }

  // Financial semantics: more income / higher net is good (green); more spend is bad (red).
  const isGood = metric === "spend" ? delta.direction === "down" : delta.direction === "up";
  const Arrow = delta.direction === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-medium tabular-nums",
        isGood ? "bg-[color-mix(in_oklab,var(--positive)_16%,transparent)] text-[var(--positive)]" : "bg-[color-mix(in_oklab,var(--negative)_16%,transparent)] text-[var(--negative)]"
      )}
    >
      <Arrow className="size-3" />
      {Math.abs(delta.pct).toFixed(2)}%
    </span>
  );
}
