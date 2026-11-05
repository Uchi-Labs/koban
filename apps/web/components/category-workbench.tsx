"use client";

import type { Category } from "@ai-finances/schema";
import { GripVertical, Lock, Pencil, Plus } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { CategoryEditDialog } from "@/components/category-manager";
import { CategoryPill } from "@/components/category-pill";
import { NewCategoryDialog } from "@/components/new-category-dialog";
import { Button } from "@/components/ui/button";
import { Card as IconiqCard, CardContent as IconiqCardContent } from "@/components/ui/iconiq-card";
import { RollingDigits } from "@/components/ui/rolling-digits";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiErrorMessage } from "@/lib/api-error-envelope";
import { formatCurrency } from "@/lib/format";
import { EASE_OUT, EASE_SMOOTH_OUT, ROLLING_DIGITS_HERO } from "@/lib/motion";
import { categoryColorPalette } from "@/lib/category-style";
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
    <main className="@container/page flex min-h-svh flex-col" data-testid="categories-page">
      <header className="flex items-center justify-between gap-3 h-14 shrink-0 border-b border-border px-6">
        <span className="text-[13px] font-semibold tracking-tight">Categories</span>
        <Button onClick={() => setCreating(true)} size="sm" type="button" variant="outline">
          <Plus className="size-4" />
          New category
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col gap-5 p-6 @6xl/page:max-w-[80rem]">
        <div className="grid items-start gap-5 @6xl/page:grid-cols-[minmax(0,1.55fr)_minmax(30rem,0.8fr)]">
          <div className="flex min-w-0 flex-col gap-5">
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

          <aside className="hidden @6xl/page:sticky @6xl/page:top-20 @6xl/page:flex @6xl/page:flex-col @6xl/page:gap-5">
            <AllCategoriesList
              onSelect={setSelectedId}
              selectedId={selectedId}
              summaries={summaries.filter((summary) => !summary.archived)}
            />
            <KeyMetrics detail={activeDetail} transactionsToReview={transactionsToReview} />
          </aside>
        </div>
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
        "iconiq-theme flex w-full items-center justify-around gap-4 rounded-lg border bg-card/95 px-4 py-5 text-left sm:gap-8 sm:px-8 shadow-[var(--ic-card-rest-shadow)] transition-[background-color,border-color,box-shadow] duration-250 ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
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
  const reduce = useReducedMotion();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  return (
    <section
      aria-label="Regular categories"
      className="@container/cattable iconiq-theme rounded-lg border border-border/70 bg-card/95 shadow-[var(--ic-card-rest-shadow)]"
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
      <div className="hidden grid-cols-[minmax(9rem,1fr)_minmax(3rem,10rem)_5.5rem_5.5rem_5.5rem_1.75rem] items-center gap-3 border-b border-border px-4 pb-2 @xl/cattable:grid">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Category</span>
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Budget used</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Spent</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Budget</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Left</span>
        <span aria-hidden="true" />
      </div>
      <LazyMotion features={domAnimation}>
        <div className="px-1.5 py-1.5">
          {summaries.map((summary) => (
            <CategoryTableRow
              draggable={inlineEditId !== summary.id}
              editingInline={inlineEditId === summary.id}
              isDragging={draggedId === summary.id}
              key={summary.id}
              monthLabel={monthLabel}
              onCloseEdit={() => setInlineEditId(null)}
              onEdit={() => setInlineEditId(summary.id)}
              onOpenMore={() => {
                setInlineEditId(null);
                onEdit(summary);
              }}
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
              reduce={Boolean(reduce)}
              selected={selectedId === summary.id}
              summary={summary}
            />
          ))}
          {summaries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No categories yet.</p>
          ) : null}
        </div>
      </LazyMotion>
    </section>
  );
}

function CategoryTableRow({
  draggable,
  editingInline,
  isDragging,
  monthLabel,
  onCloseEdit,
  onEdit,
  onOpenMore,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
  reduce,
  selected,
  summary
}: {
  draggable: boolean;
  editingInline: boolean;
  isDragging: boolean;
  monthLabel: string;
  onCloseEdit: () => void;
  onEdit: () => void;
  onOpenMore: () => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onSelect: () => void;
  reduce: boolean;
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
    <m.div
      layout={reduce ? false : "position"}
      transition={reduce ? undefined : { layout: { duration: 0.25, ease: EASE_SMOOTH_OUT } }}
    >
      <m.div
        animate={reduce
          ? { opacity: isDragging ? 0.85 : 1 }
          : { opacity: isDragging ? 0.94 : 1, transform: isDragging ? "scale(1.01)" : "scale(1)" }}
        transition={{ duration: reduce ? 0.1 : 0.15, ease: reduce ? EASE_OUT : EASE_SMOOTH_OUT }}
      >
        <div
          aria-label={`View ${summary.name}`}
          aria-pressed={selected}
          className={cn(
            "group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_1.75rem] items-center gap-3 rounded-xl px-2.5 py-2 outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 @xl/cattable:grid-cols-[minmax(9rem,1fr)_minmax(3rem,10rem)_5.5rem_5.5rem_5.5rem_1.75rem]",
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
          <div className="hidden @xl/cattable:block">
            {summary.budgetAmount ? (
              <BudgetBar color={summary.color} pct={pct} />
            ) : (
              <span className="block text-[11px] text-muted-foreground">No budget</span>
            )}
          </div>
          <span className="text-right text-sm tabular-nums">{formatCurrency(summary.spentThisMonth)}</span>
          <span className="hidden text-right text-sm tabular-nums text-muted-foreground @xl/cattable:block">
            {summary.budgetAmount ? formatCurrency(summary.budgetAmount) : "—"}
          </span>
          <span
            className={cn(
              "hidden text-right text-sm tabular-nums @xl/cattable:block",
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
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
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
        <AnimatePresence initial={false}>
          {editingInline ? (
            <m.div
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              key="inline-editor"
              transition={{ duration: reduce ? 0 : 0.22, ease: EASE_SMOOTH_OUT }}
            >
              <CategoryInlineEditor onClose={onCloseEdit} onOpenMore={onOpenMore} summary={summary} />
            </m.div>
          ) : null}
        </AnimatePresence>
      </m.div>
    </m.div>
  );
}

// Edits a category in place under its row. Only changed fields are sent, so a
// budget tweak never rewrites the name.
function CategoryInlineEditor({
  onClose,
  onOpenMore,
  summary
}: {
  onClose: () => void;
  onOpenMore: () => void;
  summary: CategorySummary;
}) {
  const router = useRouter();
  const initialBudget = summary.budgetAmount ? String(Math.round(summary.budgetAmount * 100) / 100) : "";
  const [name, setName] = useState(summary.name);
  const [emoji, setEmoji] = useState(summary.emoji ?? "");
  const [color, setColor] = useState(summary.color);
  const [budget, setBudget] = useState(initialBudget);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const nameRef = React.useRef<HTMLInputElement>(null);
  const budgetRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    (summary.isBuiltIn ? budgetRef : nameRef).current?.focus();
  }, [summary.isBuiltIn]);

  async function save() {
    const changes: Record<string, unknown> = {};
    const trimmedName = name.trim();
    if (!summary.isBuiltIn && trimmedName !== summary.name) {
      if (!trimmedName) {
        setMessage("Name can't be empty.");
        return;
      }
      changes.name = trimmedName;
    }
    if (emoji.trim() && emoji.trim() !== (summary.emoji ?? "")) changes.emoji = emoji.trim();
    if (color !== summary.color) changes.color = color;
    if (budget !== initialBudget) {
      const amount = Number(budget.replace(/[$,\s]/g, ""));
      if (budget.trim() !== "" && (!Number.isFinite(amount) || amount < 0)) {
        setMessage("Budget must be a positive amount.");
        return;
      }
      changes.budget_amount = budget.trim() === "" || amount === 0 ? null : amount;
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/categories/${encodeURIComponent(summary.id)}`, {
        body: JSON.stringify(changes),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        throw new Error(apiErrorMessage(body, "Couldn't save this category."));
      }
      router.refresh();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't save this category.");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const fieldClass = "h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-hidden focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";

  return (
    <div className="mx-2.5 mt-1 mb-2 flex flex-col gap-3 rounded-xl border border-border/70 bg-card px-3 py-3" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Emoji"
          className={cn(fieldClass, "w-11 text-center text-base")}
          maxLength={4}
          onChange={(event) => setEmoji(event.target.value)}
          value={emoji}
        />
        <input
          aria-label="Category name"
          className={cn(fieldClass, "min-w-0 flex-1 basis-40")}
          disabled={summary.isBuiltIn}
          onChange={(event) => setName(event.target.value)}
          ref={nameRef}
          title={summary.isBuiltIn ? "Built-in categories keep their name" : undefined}
          value={name}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="sr-only">Monthly budget</span>
          <span aria-hidden="true">$</span>
          <input
            className={cn(fieldClass, "w-24 text-right tabular-nums text-foreground")}
            inputMode="decimal"
            onChange={(event) => setBudget(event.target.value)}
            placeholder="No budget"
            ref={budgetRef}
            value={budget}
          />
          <span className="text-xs">/ mo</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-label="Color" className="flex flex-wrap gap-1.5" role="radiogroup">
          {categoryColorPalette.map((swatch) => (
            <button
              aria-checked={swatch === color}
              aria-label={swatch}
              className={cn(
                "size-5 rounded-full outline-offset-2 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none",
                swatch === color && "outline-2 outline-foreground/70"
              )}
              key={swatch}
              onClick={() => setColor(swatch)}
              role="radio"
              style={{ backgroundColor: swatch }}
              type="button"
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={onOpenMore} type="button">
            Archive or delete…
          </button>
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()} size="sm" type="button">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {message ? (
        <p aria-live="polite" className="text-xs text-[var(--negative)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Category-color fill up to the budget threshold; only the overflow segment uses the negative money semantic. */
function BudgetBar({ color, pct }: { color: string; pct: number }) {
  const safePct = Math.max(0, pct);
  const withinBudget = Math.min(100, safePct);
  const scale = Math.max(100, safePct);
  const withinWidth = safePct > 0 ? Math.max(4, (withinBudget / scale) * 100) : 0;
  const overflowWidth = safePct > 100 ? ((safePct - 100) / scale) * 100 : 0;

  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      <span
        className="block h-full shrink-0 transition-[width] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none"
        style={{ backgroundColor: color, width: `${withinWidth}%` }}
      />
      {overflowWidth > 0 ? (
        <span
          aria-hidden="true"
          className="block h-full shrink-0 bg-[var(--negative)] transition-[width] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none"
          style={{ width: `${overflowWidth}%` }}
        />
      ) : null}
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

      <div className="@6xl/page:hidden">
        <KeyMetrics detail={detail} transactionsToReview={transactionsToReview} />
      </div>
      <div className="@6xl/page:hidden">
        <AllCategoriesList onSelect={onSelect} selectedId={selectedId} summaries={summaries} />
      </div>
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

const TIMELINE_MONTHS = 12;

/**
 * Twelve months of spending against the monthly budget: every month labeled,
 * a dashed budget line, and a one-line read of how many months went over.
 * The last month is still in progress, so it is drawn lighter and left out of
 * the over-budget count and the average.
 */
function SpendTimeline({ detail }: { detail: CategoryDetail }) {
  const months = detail.monthly.slice(-TIMELINE_MONTHS);
  const budget = detail.budgetAmount && detail.budgetAmount > 0 ? detail.budgetAmount : undefined;
  const complete = months.slice(0, -1);
  const current = months.at(-1);
  const overCount = budget === undefined ? 0 : complete.filter((point) => point.spent > budget).length;
  // Whole dollars: the summary line is a read, not a ledger figure.
  const average = complete.length > 0 ? Math.round(complete.reduce((total, point) => total + point.spent, 0) / complete.length) : 0;
  const scaleMax = Math.max(1, budget ?? 0, ...months.map((point) => point.spent)) * 1.08;
  const toPercent = (value: number) => Math.min(100, (value / scaleMax) * 100);

  return (
    <IconiqCard className="rounded-lg border-border/70 bg-card/60">
      <IconiqCardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {budget !== undefined ? (
            <>
              <span className="font-medium text-foreground">
                {overCount === 0 ? "No months" : `${overCount} of ${complete.length} months`}
              </span>{" "}
              over budget · {formatCurrency(average)} a month on average
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{formatCurrency(average)}</span> a month on average over the last{" "}
              {complete.length} months
            </>
          )}
        </p>

        <div className="relative h-40">
          {budget !== undefined ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-foreground/35"
              style={{ bottom: `${toPercent(budget)}%` }}
            >
              <span className="absolute right-0 bottom-1 rounded bg-card/90 px-1 text-[11px] text-muted-foreground tabular-nums">
                Budget {formatCurrency(budget)}
              </span>
            </div>
          ) : null}
          <div className="flex h-full items-end gap-1">
            {months.map((point) => {
              const inProgress = point === current;
              const over = budget !== undefined && point.spent > budget;
              const label = `${formatMonthLong(point.month)}${inProgress ? " so far" : ""}: ${formatCurrency(point.spent)}`;
              return (
                <div className="group/bar relative flex h-full flex-1 items-end" key={point.month} title={label}>
                  <span className="pointer-events-none absolute inset-x-0 z-20 text-center text-[11px] font-medium whitespace-nowrap tabular-nums opacity-0 transition-opacity group-hover/bar:opacity-100 motion-reduce:transition-none" style={{ bottom: `calc(${toPercent(point.spent)}% + 4px)` }}>
                    {formatCompactCurrency(point.spent)}
                  </span>
                  <span
                    className={cn("w-full rounded-t-[3px] transition-[height] motion-reduce:transition-none", inProgress && "opacity-45")}
                    style={{
                      backgroundColor: point.spent === 0 ? "var(--muted)" : over ? "var(--negative)" : "color-mix(in oklab, var(--positive) 75%, var(--card))",
                      height: `${Math.max(point.spent > 0 ? 2 : 1, toPercent(point.spent))}%`
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* Narrow charts label each bar with the month's initial; wider ones spell it out. */}
        <div aria-hidden="true" className="@container/months flex gap-1 text-[11px] text-muted-foreground">
          {months.map((point) => (
            <span className={cn("min-w-0 flex-1 text-center whitespace-nowrap", point === current && "text-foreground")} key={point.month}>
              <span className="@md/months:hidden">{formatMonthLetter(point.month).charAt(0)}</span>
              <span className="hidden @md/months:inline">{formatMonthLetter(point.month)}</span>
            </span>
          ))}
        </div>
        <p className="sr-only">
          {months.map((point) => `${formatMonthLong(point.month)} ${formatCurrency(point.spent)}`).join(", ")}
        </p>
      </IconiqCardContent>
    </IconiqCard>
  );
}

function formatMonthLong(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC", year: "numeric" });
}

function formatMonthLetter(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function formatCompactCurrency(value: number): string {
  return value >= 1000 ? `$${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : formatCurrency(value);
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
      {/* Budget drops out when the list is narrow (phones, docked agent); Left still shows the gap. */}
      <IconiqCardContent className="@container/allcats flex w-full flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.75rem] items-center gap-3 px-1 pb-1.5 @sm/allcats:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem]">
        <span className="text-sm font-semibold tracking-tight">All categories</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Spent</span>
        <span className="hidden text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase @sm/allcats:block">Budget</span>
        <span className="text-right text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Left</span>
      </div>
      <ScrollArea
        className="max-h-64 @6xl/page:max-h-[420px]"
        viewportClassName="scroll-fade-y scroll-fade-sm h-fit max-h-64 @6xl/page:max-h-[420px]"
      >
        <div className="flex flex-col">
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
                "grid grid-cols-[minmax(0,1fr)_4.75rem_4.75rem] items-center gap-3 rounded-lg px-1 py-1.5 text-left outline-hidden @sm/allcats:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
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
              <span className="hidden text-right text-sm tabular-nums text-muted-foreground @sm/allcats:block">
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
      </ScrollArea>
      </IconiqCardContent>
    </IconiqCard>
  );
}
