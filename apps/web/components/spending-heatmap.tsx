"use client";

import { useReducedMotion } from "motion/react";
import { type CSSProperties, useState } from "react";
import {
  ContributionGraph,
  ContributionGraphBlock,
  ContributionGraphCalendar,
  ContributionGraphFooter,
  ContributionGraphLegend,
  ContributionGraphTotalCount
} from "@/components/ui/contribution-graph";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import type { CategoryHeatmap, SpendingHeatmapActivity } from "@/lib/spending-heatmap";

export function SpendingHeatmap({ all, categories, currency }: {
  all: SpendingHeatmapActivity[];
  categories: CategoryHeatmap[];
  currency: string;
}) {
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState("all");
  const selected = selectedId === "all" ? null : categories.find((category) => category.id === selectedId) ?? null;
  const data = selected ? selected.data : all;
  const activityByDate = new Map(data.map((activity) => [activity.date, activity]));
  const totalSpend = data.reduce((sum, activity) => sum + activity.spend, 0);
  const totalTransactions = data.reduce((sum, activity) => sum + activity.count, 0);

  return (
    <section aria-labelledby="spending-heatmap-title" className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground" id="spending-heatmap-title">Daily spending</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selected
              ? `${selected.name} · darker days are heavier ${selected.name} spend — scan across months for seasonal patterns.`
              : "Outflows only · transfers excluded · darker days reflect higher spend quantiles."}
          </p>
        </div>
        {categories.length > 0 ? (
          <Select onValueChange={(value) => setSelectedId(value ?? "all")} value={selectedId}>
            <SelectTrigger aria-label="Color the heatmap by category" className="h-8 w-auto min-w-[9rem] shrink-0 rounded-full border-border/50 bg-input/35 text-xs">
              <SelectValue>
                {(value) => (value && value !== "all" ? categories.find((category) => category.id === value)?.name ?? "All spending" : "All spending")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All spending</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                    {category.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <ContributionGraph
        animated={!reduce}
        className="w-full"
        data={data}
        key={selectedId}
        labels={{ legend: { less: "Less", more: "More" }, totalCount: "{{count}} transactions" }}
        style={selected ? ({ "--heatmap-accent": selected.color } as CSSProperties) : undefined}
        totalCount={totalTransactions}
      >
        <ContributionGraphCalendar>
          {({ activity, dayIndex, weekIndex }) => {
            const detail = activityByDate.get(activity.date);
            return (
              <ContributionGraphBlock activity={activity} dayIndex={dayIndex} weekIndex={weekIndex}>
                <div className="grid gap-1 whitespace-nowrap text-2xs leading-none">
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
