"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { NetWorthChart, type NetWorthTrendPoint } from "@/components/charts";
import { DashboardCard } from "@/components/dashboard-card";
import { FinanceStatItem, FinanceStatStrip, MoneyHero, type FinanceStatTone } from "@/components/money-hero";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type NetWorthRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

export interface NetWorthRangeTrend {
  label: NetWorthRange;
  points: NetWorthTrendPoint[];
}

const rangeOrder: NetWorthRange[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];

export function DashboardNetWorthCard({
  accountStats,
  currentNetWorth,
  currency = "USD",
  defaultRange = "1M",
  trends
}: {
  accountStats?: Array<{
    animatedCurrency?: string;
    animatedValue?: number;
    label: string;
    tone?: FinanceStatTone;
    value: string;
  }>;
  currentNetWorth: number;
  currency?: string;
  defaultRange?: NetWorthRange;
  trends: NetWorthRangeTrend[];
}) {
  const trendByRange = useMemo(() => new Map(trends.map((trend) => [trend.label, trend])), [trends]);
  const [activeRange, setActiveRange] = useState<NetWorthRange>(trendByRange.has(defaultRange) ? defaultRange : trends[0]?.label ?? "1M");
  const activeTrend = trendByRange.get(activeRange) ?? trends[0] ?? { label: activeRange, points: [] };
  const percentLabel = trendPercent(activeTrend.points);
  const positive = !percentLabel.startsWith("-");
  const { ref: rangeListRef, isOverflowing } = useHorizontalOverflow();

  return (
    <DashboardCard title="Net worth" action={{ label: "Accounts", href: "/accounts" }}>
      <div className="flex items-end justify-between gap-3" data-testid="net-worth-card" data-range={activeRange}>
        <div>
          <MoneyHero amount={currentNetWorth} currency={currency} />
          <div className="mt-1 text-xs text-muted-foreground">Net worth</div>
        </div>
        <Badge className="border-transparent font-medium tabular-nums" variant={positive ? "under-budget" : "over-budget"}>
          {percentLabel}
        </Badge>
      </div>

      <NetWorthChart className="mt-3 h-36" points={activeTrend.points} positive={positive} />

      {accountStats && accountStats.length > 0 ? (
        <FinanceStatStrip className="mt-3">
          {accountStats.map((stat) => (
            <FinanceStatItem
              animatedCurrency={stat.animatedCurrency}
              animatedValue={stat.animatedValue}
              key={stat.label}
              label={stat.label}
              tone={stat.tone}
              value={stat.value}
            />
          ))}
        </FinanceStatStrip>
      ) : null}

      <div
        ref={rangeListRef}
        aria-label="Net worth range"
        className="scroll-fade-tabs-list mt-3 flex w-full items-center gap-0.5 overflow-x-auto rounded-2xl bg-muted p-[3px] scroll-px-[var(--scroll-fade-width,3rem)] [--scroll-fade-width:2rem]"
        data-overflowing={isOverflowing ? "" : undefined}
      >
        {rangeOrder.map((range) => {
          const available = trendByRange.has(range);
          const active = range === activeRange;

          return (
            <button
              aria-pressed={active}
              className={cn(
                "min-w-10 flex-1 rounded-2xl px-1.5 py-1 text-xs font-medium tabular-nums transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                !available && "pointer-events-none opacity-40"
              )}
              disabled={!available}
              key={range}
              onClick={() => setActiveRange(range)}
              type="button"
            >
              {range}
            </button>
          );
        })}
      </div>
    </DashboardCard>
  );
}

function trendPercent(points: NetWorthTrendPoint[]) {
  const first = points[0]?.value ?? 0;
  const last = points.at(-1)?.value ?? first;

  if (first === 0) {
    return "0.00%";
  }

  const percent = ((last - first) / Math.abs(first)) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function useHorizontalOverflow() {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const checkOverflow = () => {
      setIsOverflowing(element.scrollWidth > element.clientWidth + 1);
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", checkOverflow);
      return () => window.removeEventListener("resize", checkOverflow);
    }

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(element);
    window.addEventListener("resize", checkOverflow);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkOverflow);
    };
  }, []);

  return { ref, isOverflowing };
}
