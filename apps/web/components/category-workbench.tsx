"use client";

import type { Category } from "@ai-finances/schema";
import { GripVertical, Lock, Pencil, Plus } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import React, { useEffect, useMemo, useState } from "react";
import { CategoryEditDialog } from "@/components/category-manager";
import { CategoryPill } from "@/components/category-pill";
import { NewCategoryDialog } from "@/components/new-category-dialog";
import { Button } from "@/components/ui/button";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { RollingDigits } from "@/components/ui/rolling-digits";
import { formatCurrency } from "@/lib/format";
import { EASE_OUT, ROLLING_DIGITS_HERO } from "@/lib/motion";
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
  archived: boolean;
  budgetAmount?: number;
  color: string;
  emoji: string;
  id: string;
  isBuiltIn: boolean;
  latestMerchant?: string;
  monthly: MonthPoint[];
  name: string;
  sortOrder: number;
  spentThisMonth: number;
  transactionCount: number;
  yearly: YearMetric[];
}

export interface CategorySummary {
  allTimeSpending: number;
  archived: boolean;
  budgetAmount?: number;
  color: string;
  emoji: string;
  id: string;
  isBuiltIn: boolean;
  latestMerchant?: string;
  name: string;
  sortOrder: number;
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
  const [showArchived, setShowArchived] = useState(false);
  const [orderedSummaries, setOrderedSummaries] = useState(summaries);
  useEffect(() => setOrderedSummaries(summaries), [summaries]);
  const visibleSummaries = orderedSummaries.filter((summary) => showArchived || !summary.archived);

  const detailById = useMemo(() => new Map(details.map((detail) => [detail.id, detail])), [details]);
  const activeDetail = (selectedId ? detailById.get(selectedId) : null) ?? allDetail;

  const totalBudget = useMemo(
    () => summaries.filter((summary) => !summary.archived).reduce((total, summary) => total + (summary.budgetAmount ?? 0), 0),
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

      <div className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col gap-5 p-6">
        <div aria-label="Category totals">
          <SummaryCard
            budget={totalBudget}
            monthLabel={monthLabel}
            onSelectAll={() => setSelectedId(null)}
            selectedAll={selectedId === null}
            spent={allDetail.spentThisMonth}
            summaries={summaries.filter((summary) => !summary.archived)}
          />
        </div>

        <DetailPane
          detail={activeDetail}
          hasTransactions={hasTransactions}
          monthLabel={monthLabel}
          onSelect={setSelectedId}
          selectedId={selectedId}
          summaries={summaries.filter((summary) => !summary.archived)}
          transactionsToReview={transactionsToReview}
        />

        <CategoryTable
          monthLabel={monthLabel}
          onCreate={() => setCreating(true)}
          onEdit={setEditing}
          onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
          selectedId={selectedId}
          onReorder={async (next) => {
            let activeIndex = 0;
            const reordered = showArchived
              ? next
              : orderedSummaries.map((summary) => summary.archived ? summary : next[activeIndex++] ?? summary);
            setOrderedSummaries(reordered);
            await Promise.all(reordered.map((summary, index) => fetch(`/api/v1/categories/${encodeURIComponent(summary.id)}`, {
              body: JSON.stringify({ sort_order: (index + 1) * 10 }), headers: { "Content-Type": "application/json" }, method: "PATCH"
            })));
          }}
          showArchived={showArchived}
          summaries={visibleSummaries}
          toggleArchived={() => setShowArchived((value) => !value)}
        />
      </div>

      {editing ? (
        <CategoryEditDialog
          categories={orderedSummaries}
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
        "iconiq-theme flex w-full items-center justify-around gap-8 rounded-lg border bg-card/95 px-8 py-5 text-left shadow-[var(--ic-card-rest-shadow)] transition-[background-color,border-color,box-shadow] duration-250 ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
        selectedAll ? "border-ring/50 ring-1 ring-ring/30" : "border-border/70 hover:border-foreground/11 hover:bg-card hover:shadow-[var(--ic-card-hover-shadow)]"
      )}
      onClick={onSelectAll}
      type="button"
    >
      <div className="flex flex-col gap-0.5">
        <MoneyRollingWhole className="text-2xl" value={spent} />
        <span className="text-xs text-muted-foreground">spent in {monthLabel.split(" ")[0]}</span>
      </div>
      <SpendDonut budget={budget} summaries={summaries} total={spent} />
      <div className="flex flex-col items-end gap-0.5">
        <MoneyRollingWhole className="text-2xl" value={budget} />
        <span className="text-xs text-muted-foreground">total budget</span>
      </div>
    </button>
  );
}

function SpendDonut({ budget, summaries, total }: { budget: number; summaries: CategorySummary[]; total: number }) {
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

  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const usedPct = budget > 0 ? Math.round((total / budget) * 100) : null;

  return (
    <div className="relative flex size-20 shrink-0 items-center justify-center">
      <svg aria-hidden="true" className="size-20 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" fill="none" r={radius} stroke="var(--muted)" strokeWidth="8" />
        {total > 0
          ? segments.map((segment, index) => (
              <circle
                cx="40"
                cy="40"
                fill="none"
                key={index}
                r={radius}
                stroke={segment.color}
                strokeDasharray={`${segment.fraction * circumference} ${circumference}`}
                strokeDashoffset={-segment.offset * circumference}
                strokeLinecap="round"
                strokeWidth="8"
              />
            ))
          : null}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
        {usedPct === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="text-sm font-semibold tabular-nums">
            <RollingDigits
              animationDelay={ROLLING_DIGITS_HERO.animationDelay}
              coalesceUpdates
              direction="dynamic"
              enterDamping={ROLLING_DIGITS_HERO.enterDamping}
              enterStiffness={ROLLING_DIGITS_HERO.enterStiffness}
              enterY={ROLLING_DIGITS_HERO.enterY}
              format={(value) => `${Math.round(value)}%`}
              gap={0}
              startOnView={false}
              value={usedPct}
            />
          </span>
        )}
        <span className="text-[9px] text-muted-foreground">used</span>
      </div>
    </div>
  );
}

/** Hero money figure with no cents, rolling on change -- same idiom as MoneyHero (dashboard hero cards). */
function MoneyRollingWhole({ className, value }: { className?: string; value: number }) {
  return (
    <span className={cn("money-hero text-foreground", className)}>
      <span className="money-symbol">$</span>
      <RollingDigits
        animationDelay={ROLLING_DIGITS_HERO.animationDelay}
        coalesceUpdates
        direction="dynamic"
        enterDamping={ROLLING_DIGITS_HERO.enterDamping}
        enterStiffness={ROLLING_DIGITS_HERO.enterStiffness}
        enterY={ROLLING_DIGITS_HERO.enterY}
        format={(rounded) => Math.round(rounded).toLocaleString("en-US")}
        gap={0}
        startOnView={false}
        value={value}
      />
    </span>
  );
}

// ── Unified category table (master list) ─────────────────────────────────────
// One table carries every per-category figure — the budget-progress bar plus the
// Spent / Budget / Left columns — so there is no longer a separate cramped tree
// list and a floating table repeating the same categories. Selecting a row drives
// the detail card (chart + key metrics) above it.

function CategoryTable({
  monthLabel,
  onCreate,
  onEdit,
  onSelect,
  onReorder,
  selectedId,
  showArchived,
  summaries,
  toggleArchived
}: {
  monthLabel: string;
  onCreate: () => void;
  onEdit: (summary: CategorySummary) => void;
  onSelect: (id: string) => void;
  onReorder: (summaries: CategorySummary[]) => void;
  selectedId: string | null;
  showArchived: boolean;
  summaries: CategorySummary[];
  toggleArchived: () => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  return (
    <section
      aria-label="Regular categories"
      className="iconiq-theme rounded-lg border border-border/70 bg-card/95 shadow-[var(--ic-card-rest-shadow)]"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2.5">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-semibold tracking-tight">Regular Categories</h2>
          <p className="text-xs text-muted-foreground">Spend against budget · {monthLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button aria-label="New category" onClick={onCreate} size="icon-sm" type="button" variant="ghost">
            <Plus className="size-4" />
          </Button>
          <Button onClick={toggleArchived} size="sm" type="button" variant="ghost">{showArchived ? "Hide archived" : "Show archived"}</Button>
        </div>
      </div>
      <div className="hidden grid-cols-[minmax(0,1fr)_10rem_5.5rem_5.5rem_5.5rem_1.75rem] items-center gap-3 border-b border-border px-4 pb-2 sm:grid">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Category</span>
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Budget used</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Spent</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Budget</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Left</span>
        <span aria-hidden="true" />
      </div>
      <div className="px-1.5 py-1.5">
        {summaries.map((summary) => (
          <CategoryTableRow
            draggable
            key={summary.id}
            monthLabel={monthLabel}
            onEdit={() => onEdit(summary)}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDragStart={() => setDraggedId(summary.id)}
            onDrop={() => {
              if (!draggedId || draggedId === summary.id) return;
              const from = summaries.findIndex((item) => item.id === draggedId);
              const to = summaries.findIndex((item) => item.id === summary.id);
              const next = [...summaries];
              const [moved] = next.splice(from, 1);
              if (moved) next.splice(to, 0, moved);
              onReorder(next);
            }}
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

function CategoryTableRow({
  draggable,
  monthLabel,
  onEdit,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
  selected,
  summary
}: {
  draggable: boolean;
  monthLabel: string;
  onEdit: () => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onSelect: () => void;
  selected: boolean;
  summary: CategorySummary;
}) {
  const pct = summary.budgetAmount ? (summary.spentThisMonth / summary.budgetAmount) * 100 : 0;
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
    <div
      aria-label={`View ${summary.name}`}
      aria-pressed={selected}
      className={cn(
        "group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_1.75rem] items-center gap-3 rounded-xl px-2.5 py-2 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 sm:grid-cols-[minmax(0,1fr)_10rem_5.5rem_5.5rem_5.5rem_1.75rem]",
        selected ? "bg-accent" : "hover:bg-muted/50",
        summary.archived && "opacity-55"
      )}
      draggable={draggable}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
      title={`${summary.name} · spent ${formatCurrency(summary.spentThisMonth)} in ${monthLabel}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <GripVertical aria-label={`Drag to reorder ${summary.name}`} className="size-3.5 shrink-0 cursor-grab text-muted-foreground" />
        <CategoryPill category={category} className="max-w-full" />
        {summary.isBuiltIn ? <Lock aria-label="System category" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        {summary.archived ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Archived</span> : null}
      </span>
      <div className="hidden sm:block">
        {summary.budgetAmount ? (
          <BudgetBar color={summary.color} pct={pct} />
        ) : (
          <span className="block text-[11px] text-muted-foreground">No budget</span>
        )}
      </div>
      <span className="text-right text-sm tabular-nums">{formatCurrency(summary.spentThisMonth)}</span>
      <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
        {summary.budgetAmount ? formatCurrency(summary.budgetAmount) : "—"}
      </span>
      <span
        className={cn(
          "hidden text-right text-sm tabular-nums sm:block",
          remaining === undefined
            ? "text-muted-foreground"
            : remaining < 0
              ? "text-[var(--negative)]"
              : "text-[var(--positive)]"
        )}
      >
        {remaining === undefined ? "—" : formatCurrency(remaining)}
      </span>
      <Button
        aria-label={`Edit ${summary.name}`}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );
}

/** Category-color fill on a low-alpha track of the same color; over-budget switches the fill to --negative. */
function BudgetBar({ color, pct }: { color: string; pct: number }) {
  const clamped = Math.min(100, Math.max(pct > 0 ? 4 : 0, pct));
  const overBudget = pct >= 100;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      <span
        className="block h-full rounded-full transition-[width]"
        style={{ backgroundColor: overBudget ? "var(--negative)" : color, width: `${clamped}%` }}
      />
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
  const reduce = useReducedMotion();
  const remaining = detail.budgetAmount === undefined ? undefined : detail.budgetAmount - detail.spentThisMonth;
  const pillTargets = selectedId
    ? summaries.filter((summary) => summary.id === detail.id)
    : summaries.filter((summary) => summary.spentThisMonth > 0).slice(0, 6);

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false} mode="popLayout">
    <m.section
      animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
      aria-label="Category detail"
      className="iconiq-theme flex flex-col gap-5 rounded-lg border border-border/70 bg-card/95 p-5 shadow-[var(--ic-card-rest-shadow)]"
      exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(2px)", y: -4 }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(2px)", y: 4 }}
      key={detail.id}
      transition={{ duration: 0.15, ease: EASE_OUT }}
    >
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
          <MoneyRollingWhole className="text-2xl" value={detail.spentThisMonth} />
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
      <AllCategoriesList onSelect={onSelect} selectedId={selectedId} summaries={summaries} />
    </m.section>
      </AnimatePresence>
    </LazyMotion>
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
    <IconiqCard className="rounded-lg border-border/70 bg-card/60">
      <IconiqCardContent className="flex flex-col gap-2">
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
        <div className="flex justify-between text-[10px] tracking-wide text-muted-foreground tabular-nums">
          <span>{formatMonthShort(detail.monthly[0]?.month ?? "")}</span>
          <span>{formatMonthShort(detail.monthly.at(-1)?.month ?? "")}</span>
        </div>
      </IconiqCardContent>
    </IconiqCard>
  );
}

function KeyMetrics({ detail, transactionsToReview }: { detail: CategoryDetail; transactionsToReview: number }) {
  if (detail.yearly.length === 0) {
    return null;
  }

  return (
    <IconiqCard className="rounded-lg border-border/70 bg-card/60">
      <IconiqCardContent className="flex w-full flex-col gap-1">
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
      </IconiqCardContent>
    </IconiqCard>
  );
}

/** Compact all-categories recap (name, spent, budget, left) inside the detail pane, per the Copilot reference's right-panel list. Always shows every category, independent of the current selection. */
function AllCategoriesList({
  onSelect,
  selectedId,
  summaries
}: {
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  summaries: CategorySummary[];
}) {
  if (summaries.length === 0) {
    return null;
  }

  return (
    <IconiqCard className="rounded-lg border-border/70 bg-card/60">
      <IconiqCardContent className="flex w-full flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center gap-3 px-1 pb-1.5">
        <span className="text-sm font-semibold tracking-tight">All categories</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Spent</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Budget</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Left</span>
      </div>
      <div className="scroll-fade-sm flex max-h-64 flex-col overflow-y-auto">
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
                "grid grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center gap-3 rounded-lg px-1 py-1.5 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                selectedId === summary.id ? "bg-accent" : "hover:bg-muted/40"
              )}
              key={summary.id}
              onClick={() => onSelect(summary.id === selectedId ? null : summary.id)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                <CategoryPill category={category} className="max-w-full" />
              </span>
              <span className="text-right text-sm tabular-nums">{formatCurrency(summary.spentThisMonth)}</span>
              <span className="text-right text-sm tabular-nums text-muted-foreground">
                {summary.budgetAmount ? formatCurrency(summary.budgetAmount) : "—"}
              </span>
              <span
                className={cn(
                  "text-right text-sm tabular-nums",
                  remaining === undefined ? "text-muted-foreground" : remaining < 0 ? "text-(--negative)" : "text-(--positive)"
                )}
              >
                {remaining === undefined ? "—" : formatCurrency(remaining)}
              </span>
            </button>
          );
        })}
      </div>
      </IconiqCardContent>
    </IconiqCard>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
