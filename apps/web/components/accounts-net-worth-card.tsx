"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { NetWorthChart } from "@/components/charts";
import type { NetWorthRange, NetWorthRangeTrend } from "@/components/dashboard-net-worth-card";
import { MoneyHero } from "@/components/money-hero";
import { Badge } from "@/components/ui/badge";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { netWorthTrendPercent } from "@/lib/net-worth-trend";
import { cn } from "@/lib/utils";

const rangeOrder: NetWorthRange[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];

/**
 * Accounts-page net-worth hero -- same underlying data/pieces as the dashboard's
 * DashboardNetWorthCard (MoneyHero, NetWorthChart, range tabs) but presented as a
 * standalone full-width header instead of a titled DashboardCard, matching the
 * Copilot reference's "Net worth" hero at the top of the Accounts page.
 */
export function AccountsNetWorthCard({
  currency = "USD",
  currentNetWorth,
  defaultRange = "1M",
  settingsSlot,
  trends
}: {
  currency?: string;
  currentNetWorth: number;
  defaultRange?: NetWorthRange;
  settingsSlot?: React.ReactNode;
  trends: NetWorthRangeTrend[];
}) {
  const trendByRange = useMemo(() => new Map(trends.map((trend) => [trend.label, trend])), [trends]);
  const [activeRange, setActiveRange] = useState<NetWorthRange>(
    trendByRange.has(defaultRange) ? defaultRange : (trends[0]?.label ?? "1M")
  );
  const activeTrend = trendByRange.get(activeRange) ?? trends[0] ?? { label: activeRange, points: [] };
  const percentLabel = netWorthTrendPercent(activeTrend.points);
  const positive = !percentLabel.startsWith("-");
  const { ref: rangeListRef, isOverflowing } = useHorizontalOverflow();

  return (
    <IconiqCard className="gap-0 rounded-2xl border-border/60 bg-card/95 py-0 shadow-[var(--ic-card-rest-shadow)]" data-testid="accounts-net-worth-card">
      <IconiqCardContent className="flex flex-col gap-4 px-6 py-6">
        <div className="flex items-start justify-between gap-3" data-range={activeRange}>
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Net worth</p>
            <MoneyHero amount={currentNetWorth} className="mt-1 text-3xl" currency={currency} rolling />
            <Badge className="mt-2 border-transparent font-medium tabular-nums" variant={positive ? "under-budget" : "over-budget"}>
              {percentLabel}
            </Badge>
          </div>
          {settingsSlot}
        </div>

        <NetWorthChart className="h-40" points={activeTrend.points} positive={positive} />

        <div
          ref={rangeListRef}
          aria-label="Net worth range"
          className="scroll-fade-tabs-list flex w-full items-center gap-0.5 overflow-x-auto rounded-2xl bg-muted p-[3px] scroll-px-[var(--scroll-fade-width,3rem)] [--scroll-fade-width:2rem]"
          data-overflowing={isOverflowing ? "" : undefined}
        >
          {rangeOrder.map((range) => {
            const available = trendByRange.has(range);
            const active = range === activeRange;

            return (
              <button
                aria-pressed={active}
                className={cn(
                  "min-w-10 flex-1 rounded-2xl px-1.5 py-1.5 text-xs font-medium tabular-nums transition-colors",
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  !available && "hidden"
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
      </IconiqCardContent>
    </IconiqCard>
  );
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
