"use client";

import { useReducedMotion } from "motion/react";
import {
  ContributionGraph,
  ContributionGraphBlock,
  ContributionGraphCalendar,
  ContributionGraphFooter,
  ContributionGraphLegend,
  ContributionGraphTotalCount
} from "@/components/ui/contribution-graph";
import { formatCurrency } from "@/lib/format";
import type { SpendingHeatmapActivity } from "@/lib/spending-heatmap";

export function SpendingHeatmap({ currency, data }: { currency: string; data: SpendingHeatmapActivity[] }) {
  const reduce = useReducedMotion();
  const activityByDate = new Map(data.map((activity) => [activity.date, activity]));
  const totalSpend = data.reduce((sum, activity) => sum + activity.spend, 0);
  const totalTransactions = data.reduce((sum, activity) => sum + activity.count, 0);

  return (
    <section aria-labelledby="spending-heatmap-title" className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground" id="spending-heatmap-title">Daily spending</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Outflows only · transfers excluded · darker days reflect higher spend quantiles.</p>
      </div>
      <ContributionGraph
        animated={!reduce}
        className="w-full"
        data={data}
        labels={{ legend: { less: "Less", more: "More" }, totalCount: "{{count}} transactions" }}
        totalCount={totalTransactions}
      >
        <ContributionGraphCalendar>
          {({ activity, dayIndex, weekIndex }) => {
            const detail = activityByDate.get(activity.date);
            return (
              <ContributionGraphBlock activity={activity} dayIndex={dayIndex} weekIndex={weekIndex}>
                <div className="grid gap-1 whitespace-nowrap text-[11px] leading-none">
                  <span className="font-semibold tabular-nums">{formatCurrency(detail?.spend ?? 0, currency)}</span>
                  <span className="text-muted-foreground">
                    {formatHeatmapDate(activity.date)} · {activity.count} {activity.count === 1 ? "transaction" : "transactions"}
                  </span>
                </div>
              </ContributionGraphBlock>
            );
          }}
        </ContributionGraphCalendar>
        <ContributionGraphFooter className="text-xs">
          <ContributionGraphTotalCount>
            {() => (
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{formatCurrency(totalSpend, currency)}</span> across{" "}
                <span className="tabular-nums">{totalTransactions.toLocaleString()}</span> transactions
              </span>
            )}
          </ContributionGraphTotalCount>
          <ContributionGraphLegend />
        </ContributionGraphFooter>
      </ContributionGraph>
    </section>
  );
}

function formatHeatmapDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}
