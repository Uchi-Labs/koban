"use client";

import type { Category } from "@ai-finances/schema";
import { Pencil, Plus } from "lucide-react";
import React, { useMemo, useState } from "react";
import { CategoryEditDialog } from "@/components/category-manager";
import { CategoryPill } from "@/components/category-pill";
import { NewCategoryDialog } from "@/components/new-category-dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MonthPoint {
  month: string;
  spent: number;
}

export interface YearMetric {
  year: string;
  spent: number;
  avgMonthly: number;
}

export interface CategoryDetail {
  allTimeSpending: number;
  budgetAmount?: number;
  color: string;
  emoji: string;
  id: string;
  isBuiltIn: boolean;
  latestMerchant?: string;
  monthly: MonthPoint[];
  name: string;
  spentThisMonth: number;
  transactionCount: number;
  yearly: YearMetric[];
}

export interface CategorySummary {
  allTimeSpending: number;
  budgetAmount?: number;
  color: string;
  emoji: string;
  id: string;
  isBuiltIn: boolean;
  latestMerchant?: string;
  name: string;
  spentThisMonth: number;
  transactionCount: number;
}

export function CategoryWorkbench({
  aiSuggestionEnabled,
  aiSuggestionMessage,
  allDetail,
  details,
  hasTransactions,
  monthLabel,
  summaries,
  transactionsToReview,
  uncategorizedMerchants
}: {
  aiSuggestionEnabled: boolean;
  aiSuggestionMessage: string;
  allDetail: CategoryDetail;
  details: CategoryDetail[];
  hasTransactions: boolean;
  monthLabel: string;
  summaries: CategorySummary[];
  transactionsToReview: number;
  uncategorizedMerchants: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategorySummary | null>(null);
  const [creating, setCreating] = useState(false);

  const detailById = useMemo(() => new Map(details.map((detail) => [detail.id, detail])), [details]);
  const activeDetail = (selectedId ? detailById.get(selectedId) : null) ?? allDetail;

  const totalBudget = useMemo(
    () => summaries.reduce((total, summary) => total + (summary.budgetAmount ?? 0), 0),
    [summaries]
  );

  return (
    <main className="flex min-h-svh flex-col" data-testid="categories-page">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Categories</span>
        <Button onClick={() => setCreating(true)} size="sm" type="button" variant="outline">
          <Plus className="size-4" />
          New category
        </Button>
      </header>

      <div className="grid flex-1 grid-cols-1 items-start gap-6 p-6 xl:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div aria-label="Category totals">
            <SummaryCard
              budget={totalBudget}
              monthLabel={monthLabel}
              onSelectAll={() => setSelectedId(null)}
              selectedAll={selectedId === null}
              spent={allDetail.spentThisMonth}
              summaries={summaries}
            />
          </div>
          <CategoryTree
            monthLabel={monthLabel}
            onCreate={() => setCreating(true)}
            onEdit={setEditing}
            onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
            selectedId={selectedId}
            summaries={summaries}
          />
        </div>

        <DetailPane
          detail={activeDetail}
          hasTransactions={hasTransactions}
          monthLabel={monthLabel}
          onSelect={setSelectedId}
          selectedId={selectedId}
          summaries={summaries}
          transactionsToReview={transactionsToReview}
        />
      </div>

      {editing ? (
        <CategoryEditDialog
          category={editing}
          key={editing.id}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
            }
          }}
          open={Boolean(editing)}
        />
      ) : null}

      {creating ? (
        <NewCategoryDialog
          aiSuggestionEnabled={aiSuggestionEnabled}
          aiSuggestionMessage={aiSuggestionMessage}
          onOpenChange={setCreating}
          open
          uncategorizedMerchants={uncategorizedMerchants}
        />
      ) : null}
    </main>
  );
}

// ── Left: summary card ───────────────────────────────────────────────────────

function SummaryCard({
  budget,
  monthLabel,
  onSelectAll,
  selectedAll,
  spent,
  summaries
}: {
  budget: number;
  monthLabel: string;
  onSelectAll: () => void;
  selectedAll: boolean;
  spent: number;
  summaries: CategorySummary[];
}) {
  return (
    <button
      className={cn(
        "flex items-center justify-between gap-4 rounded-2xl border bg-card px-5 py-5 text-left transition-colors",
        selectedAll ? "border-ring/50 ring-1 ring-ring/30" : "border-border hover:border-border/80 hover:bg-muted/30"
      )}
      onClick={onSelectAll}
      type="button"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-2xl font-semibold tabular-nums">{formatWhole(spent)}</span>
        <span className="text-xs text-muted-foreground">spent in {monthLabel.split(" ")[0]}</span>
      </div>
      <SpendDonut summaries={summaries} total={spent} />
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-2xl font-semibold tabular-nums">{formatWhole(budget)}</span>
        <span className="text-xs text-muted-foreground">total budget</span>
      </div>
    </button>
  );
}

function SpendDonut({ summaries, total }: { summaries: CategorySummary[]; total: number }) {
  const segments = useMemo(() => {
    const spenders = summaries
      .filter(
        (summary) =>
          summary.spentThisMonth > 0 &&
          summary.id !== "cat_income" &&
          summary.id !== "cat_transfer" &&
          summary.id !== "cat_other"
      )
      .sort((left, right) => right.spentThisMonth - left.spentThisMonth)
      .slice(0, 8);
    const sum = spenders.reduce((accumulator, summary) => accumulator + summary.spentThisMonth, 0) || 1;
    let offset = 0;
    return spenders.map((summary) => {
      const fraction = summary.spentThisMonth / sum;
      const segment = { color: summary.color, fraction, offset };
      offset += fraction;
      return segment;
    });
  }, [summaries]);

  const radius = 26;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg aria-hidden="true" className="size-[68px] shrink-0 -rotate-90" viewBox="0 0 68 68">
      <circle cx="34" cy="34" fill="none" r={radius} stroke="var(--muted)" strokeWidth="9" />
      {total > 0
        ? segments.map((segment, index) => (
            <circle
              cx="34"
              cy="34"
              fill="none"
              key={index}
              r={radius}
              stroke={segment.color}
              strokeDasharray={`${segment.fraction * circumference} ${circumference}`}
              strokeDashoffset={-segment.offset * circumference}
              strokeWidth="9"
            />
          ))
        : null}
    </svg>
  );
}

// ── Left: category tree ──────────────────────────────────────────────────────

function CategoryTree({
  monthLabel,
  onCreate,
  onEdit,
  onSelect,
  selectedId,
  summaries
}: {
  monthLabel: string;
  onCreate: () => void;
  onEdit: (summary: CategorySummary) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  summaries: CategorySummary[];
}) {
  return (
    <section aria-label="Regular categories" className="rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-semibold tracking-tight">Regular Categories</h2>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-6 text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:flex">
            <span className="w-16 text-right">Spent</span>
            <span className="w-16 text-right">Budget</span>
          </div>
          <Button aria-label="New category" onClick={onCreate} size="icon-sm" type="button" variant="ghost">
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
      <div className="px-1.5 pb-2">
        {summaries.map((summary) => (
          <CategoryTreeRow
            key={summary.id}
            monthLabel={monthLabel}
            onEdit={() => onEdit(summary)}
            onSelect={() => onSelect(summary.id)}
            selected={selectedId === summary.id}
            summary={summary}
          />
        ))}
        {summaries.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No categories yet.</p>
        ) : null}
      </div>
    </section>
  );
}

function CategoryTreeRow({
  monthLabel,
  onEdit,
  onSelect,
  selected,
  summary
}: {
  monthLabel: string;
  onEdit: () => void;
  onSelect: () => void;
  selected: boolean;
  summary: CategorySummary;
}) {
  const pct = summary.budgetAmount ? (summary.spentThisMonth / summary.budgetAmount) * 100 : 0;

  return (
    <div
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl px-2.5 py-1.5 transition-colors",
        selected ? "bg-accent" : "hover:bg-muted/50"
      )}
    >
      <button
        aria-label={`View ${summary.name}`}
        aria-pressed={selected}
        className="flex min-w-0 items-center gap-2.5 py-1 text-left outline-hidden"
        onClick={onSelect}
        type="button"
      >
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: summary.color }} />
        <span aria-hidden="true" className="text-sm leading-none">
          {summary.emoji}
        </span>
        <span className="truncate text-sm font-medium">{summary.name}</span>
      </button>
      <div className="flex items-center gap-3">
        <span className="w-16 text-right text-sm tabular-nums">{formatWhole(summary.spentThisMonth)}</span>
        <div className="hidden w-24 sm:block">
          {summary.budgetAmount ? (
            <BudgetBar pct={pct} />
          ) : (
            <span className="block text-right text-[11px] text-muted-foreground">No budget</span>
          )}
        </div>
        <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">
          {summary.budgetAmount ? formatWhole(summary.budgetAmount) : "—"}
        </span>
        <Button
          aria-label={`Edit ${summary.name}`}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onEdit}
          size="icon-sm"
          title={`${summary.name} · spent ${formatCurrency(summary.spentThisMonth)} in ${monthLabel}`}
          type="button"
          variant="ghost"
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function BudgetBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(pct > 0 ? 4 : 0, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className="block h-full rounded-full transition-[width]" style={{ backgroundColor: budgetHealthColor(pct), width: `${clamped}%` }} />
    </div>
  );
}

// ── Right: detail pane ───────────────────────────────────────────────────────

function DetailPane({
  detail,
  hasTransactions,
  monthLabel,
  onSelect,
  selectedId,
  summaries,
  transactionsToReview
}: {
  detail: CategoryDetail;
  hasTransactions: boolean;
  monthLabel: string;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  summaries: CategorySummary[];
  transactionsToReview: number;
}) {
  const remaining = detail.budgetAmount === undefined ? undefined : detail.budgetAmount - detail.spentThisMonth;
  const pillTargets = selectedId
    ? summaries.filter((summary) => summary.id === detail.id)
    : summaries.filter((summary) => summary.spentThisMonth > 0).slice(0, 6);

  return (
    <section aria-label="Category detail" className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            {selectedId ? (
              <span aria-hidden="true" className="text-lg">
                {detail.emoji}
              </span>
            ) : null}
            {detail.name}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedId ? (
              <button
                className="inline-flex h-6 items-center rounded-full border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                onClick={() => onSelect(null)}
                type="button"
              >
                All Regular Categories
              </button>
            ) : null}
            {pillTargets.map((summary) => (
              <PillButton
                key={summary.id}
                onClick={() => onSelect(summary.id === detail.id && selectedId ? null : summary.id)}
                selected={summary.id === detail.id && Boolean(selectedId)}
                summary={summary}
              />
            ))}
            {!selectedId && summaries.length > pillTargets.length ? (
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-xs text-muted-foreground">
                +{summaries.length - pillTargets.length}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Spent in {monthLabel.split(" ")[0]}</span>
          <span className="text-2xl font-semibold tabular-nums">{formatCurrency(detail.spentThisMonth)}</span>
          {remaining !== undefined ? (
            <span className={cn("text-xs tabular-nums", remaining < 0 ? "text-[var(--negative)]" : "text-muted-foreground")}>
              {remaining < 0 ? `${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No budget</span>
          )}
        </div>
      </div>

      {hasTransactions ? (
        <SpendTimeline detail={detail} />
      ) : (
        <div className="grid place-items-center rounded-xl border border-dashed border-border py-12 text-sm text-muted-foreground">
          No transactions synced yet — sync a source to see spend over time.
        </div>
      )}

      <KeyMetrics detail={detail} transactionsToReview={transactionsToReview} />

      <RegularCategoriesTable monthLabel={monthLabel} onSelect={onSelect} selectedId={selectedId} summaries={summaries} />
    </section>
  );
}

function PillButton({
  onClick,
  selected,
  summary
}: {
  onClick: () => void;
  selected: boolean;
  summary: CategorySummary;
}) {
  const category: Category = {
    archived: false,
    color: summary.color,
    emoji: summary.emoji,
    icon: "circle",
    id: summary.id,
    name: summary.name,
    sortOrder: 0
  };
  return (
    <button className={cn("rounded-full outline-hidden", selected ? "ring-2 ring-ring/50" : "")} onClick={onClick} type="button">
      <CategoryPill category={category} className="cursor-pointer transition-[filter] hover:brightness-110" />
    </button>
  );
}

function SpendTimeline({ detail }: { detail: CategoryDetail }) {
  const max = Math.max(1, ...detail.monthly.map((point) => point.spent));
  const monthlyBudget = detail.budgetAmount;

  return (
    <div className="rounded-xl border border-border/70 bg-background/40 p-4">
      <div className="flex h-32 items-end gap-[3px]">
        {detail.monthly.map((point) => {
          const height = (point.spent / max) * 100;
          const overBudget = monthlyBudget !== undefined && point.spent > monthlyBudget;
          return (
            <div
              className="group/bar relative flex h-full flex-1 items-end"
              key={point.month}
              title={`${formatMonthShort(point.month)}: ${formatCurrency(point.spent)}`}
            >
              <span
                className="w-full rounded-sm transition-[height]"
                style={{
                  backgroundColor: point.spent === 0 ? "var(--muted)" : overBudget ? "var(--negative)" : "var(--positive)",
                  height: `${Math.max(point.spent > 0 ? 3 : 1.5, height)}%`,
                  opacity: point.spent === 0 ? 0.4 : 1
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] tracking-wide text-muted-foreground tabular-nums">
        <span>{formatMonthShort(detail.monthly[0]?.month ?? "")}</span>
        <span>{formatMonthShort(detail.monthly.at(-1)?.month ?? "")}</span>
      </div>
    </div>
  );
}

function KeyMetrics({ detail, transactionsToReview }: { detail: CategoryDetail; transactionsToReview: number }) {
  if (detail.yearly.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-3 px-1 pb-1.5">
        <span className="text-sm font-semibold tracking-tight">Key metrics</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Spent / year</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Avg / month</span>
      </div>
      {detail.yearly.map((row) => (
        <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-muted/40" key={row.year}>
          <span className="text-sm text-muted-foreground tabular-nums">{row.year}</span>
          <span className="text-right text-sm tabular-nums">{formatCurrency(row.spent)}</span>
          <span className="text-right text-sm tabular-nums">{formatCurrency(row.avgMonthly)}</span>
        </div>
      ))}
      {detail.id === "__all__" && transactionsToReview > 0 ? (
        <p className="px-1 pt-1 text-xs text-muted-foreground">{transactionsToReview.toLocaleString()} transactions still to review.</p>
      ) : null}
    </div>
  );
}

function RegularCategoriesTable({
  monthLabel,
  onSelect,
  selectedId,
  summaries
}: {
  monthLabel: string;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  summaries: CategorySummary[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center gap-3 border-b border-border px-1 pb-2">
        <span className="text-sm font-semibold tracking-tight">Regular Categories</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Spent</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Budget</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Left</span>
      </div>
      {summaries.map((summary) => {
        const remaining = summary.budgetAmount === undefined ? undefined : summary.budgetAmount - summary.spentThisMonth;
        const category: Category = {
          archived: false,
          color: summary.color,
          emoji: summary.emoji,
          icon: "circle",
          id: summary.id,
          name: summary.name,
          sortOrder: 0
        };
        return (
          <button
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center gap-3 rounded-lg px-1 py-1.5 text-left transition-colors",
              selectedId === summary.id ? "bg-accent" : "hover:bg-muted/40"
            )}
            key={summary.id}
            onClick={() => onSelect(selectedId === summary.id ? null : summary.id)}
            title={`${summary.name} · ${monthLabel}`}
            type="button"
          >
            <span className="min-w-0">
              <CategoryPill category={category} className="max-w-full" />
            </span>
            <span className="text-right text-sm tabular-nums">{formatCurrency(summary.spentThisMonth)}</span>
            <span className="text-right text-sm tabular-nums text-muted-foreground">
              {summary.budgetAmount ? formatCurrency(summary.budgetAmount) : "—"}
            </span>
            <span
              className={cn(
                "text-right text-sm tabular-nums",
                remaining === undefined ? "text-muted-foreground" : remaining < 0 ? "text-[var(--negative)]" : "text-[var(--positive)]"
              )}
            >
              {remaining === undefined ? "—" : formatCurrency(remaining)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function budgetHealthColor(pct: number): string {
  if (pct >= 100) {
    return "var(--negative)";
  }
  if (pct >= 75) {
    return "oklch(0.78 0.15 72)";
  }
  return "var(--positive)";
}

function formatWhole(value: number): string {
  return formatCurrency(Math.round(value));
}

function formatMonthShort(month: string): string {
  if (!month) {
    return "";
  }
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "2-digit"
  });
}
