"use client";

import type { Category } from "@ai-finances/schema";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, RotateCcw } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion, type PanInfo } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CategoryPill } from "@/components/category-pill";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/ui/category-picker";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import { formatCurrency } from "@/lib/format";
import { merchantDomain } from "@/lib/merchant-domain";
import { EASE_OUT, EASE_SMOOTH_OUT, SPRING_LAYOUT } from "@/lib/motion";
import type { TransactionView } from "@/lib/view-models";

type ReviewAction = "accept" | "categorize" | "review" | "skip";
interface HistoryItem { action: ReviewAction; categoryId: string; previousCategoryId: string; transactionId: string }

export function ReviewStack({ categories, initialTransactions, suggestions }: {
  categories: Category[];
  initialTransactions: TransactionView[];
  suggestions: Record<string, string>;
}) {
  const reduce = useReducedMotion();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [exit, setExit] = useState<{ x: number; y: number } | null>(null);
  const current = initialTransactions[history.length];
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const suggestedId = current ? suggestions[current.id] ?? current.categoryId : undefined;
  const suggestedCategory = suggestedId ? categoryById.get(suggestedId) ?? current?.category : undefined;
  const reviewed = history.filter((item) => item.action !== "skip").length;
  const recategorized = history.filter((item) => item.action === "categorize" || (item.action === "accept" && item.categoryId !== item.previousCategoryId)).length;

  const advance = useCallback(async (action: ReviewAction, categoryId?: string) => {
    if (!current || busy) return;
    const targetCategoryId = categoryId ?? current.categoryId;
    setBusy(true);
    setMessage("");
    const vector = action === "skip" ? { x: -520, y: 0 } : action === "categorize" ? { x: 0, y: -520 } : action === "review" ? { x: 0, y: 520 } : { x: 520, y: 0 };
    setExit(vector);
    try {
      if (action !== "skip") {
        const body = targetCategoryId === current.categoryId
          ? { reviewed: true }
          : { category_id: targetCategoryId, reviewed: true };
        const response = await fetch(`/api/v1/transactions/${encodeURIComponent(current.id)}`, {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "PATCH"
        });
        if (!response.ok) throw new Error("Unable to save this review.");
      }
      setHistory((items) => [...items, { action, categoryId: targetCategoryId, previousCategoryId: current.categoryId, transactionId: current.id }]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this review.");
    } finally {
      setExit(null);
      setBusy(false);
    }
  }, [busy, current]);

  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!last || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (last.action !== "skip") {
        const body = last.categoryId === last.previousCategoryId
          ? { reviewed: false }
          : { category_id: last.previousCategoryId, reviewed: false };
        const response = await fetch(`/api/v1/transactions/${encodeURIComponent(last.transactionId)}`, {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "PATCH"
        });
        if (!response.ok) throw new Error("Unable to undo the last review.");
      }
      setHistory((items) => items.slice(0, -1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to undo the last review.");
    } finally { setBusy(false); }
  }, [busy, history]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (pickerOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j") { event.preventDefault(); void advance("skip"); }
      else if (event.key === "k") { event.preventDefault(); setPickerOpen(true); }
      else if (event.key === "Enter") { event.preventDefault(); void advance("accept", suggestedId); }
      else if (event.key.toLowerCase() === "u") { event.preventDefault(); void undo(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, pickerOpen, suggestedId, undo]);

  function onDragEnd(_event: PointerEvent, info: PanInfo) {
    const projectedX = info.offset.x + info.velocity.x * 0.16;
    const projectedY = info.offset.y + info.velocity.y * 0.16;
    if (Math.abs(projectedX) > Math.abs(projectedY) && Math.abs(projectedX) > 115) {
      void advance(projectedX > 0 ? "accept" : "skip", projectedX > 0 ? suggestedId : undefined);
    } else if (projectedY < -115) setPickerOpen(true);
    else if (projectedY > 115) void advance("review");
  }

  const weekLabel = current ? formatWeek(current.date) : "Review complete";
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col px-4 py-5 md:px-6" data-testid="review-page">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div><h1 className="app-page-title">Review transactions</h1><p className="mt-1.5 text-sm text-muted-foreground">{weekLabel}</p></div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium tabular-nums">{Math.min(history.length + 1, initialTransactions.length)} of {initialTransactions.length}</span>
      </header>

      <div className="relative mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
        <LazyMotion features={domAnimation}>
          <AnimatePresence mode="wait">
            {current ? (
              <m.article
                animate={exit ?? { opacity: 1, rotate: 0, scale: 1, x: 0, y: 0 }}
                className="relative touch-none select-none rounded-3xl border border-border bg-card p-6 shadow-xl"
                drag={busy ? false : true}
                dragConstraints={{ bottom: 0, left: 0, right: 0, top: 0 }}
                dragElastic={0.72}
                dragMomentum={false}
                exit={exit
                  ? reduce
                    ? { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }
                    : {
                        opacity: 0,
                        transform: `translate3d(${exit.x}px, ${exit.y}px, 0) scale(0.98)`,
                        transition: { duration: 0.15, ease: EASE_OUT }
                      }
                  : {
                      opacity: 1,
                      transform: "translate3d(0, 0, 0) scale(1)",
                      transition: { duration: 0 }
                    }}
                initial={reduce ? false : { opacity: 0, scale: 0.96, y: 12 }}
                key={current.id}
                onDragEnd={onDragEnd}
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                whileDrag={{ cursor: "grabbing", rotate: 1.5, scale: 1.015 }}
              >
                <div className="flex items-center gap-3">
                  {merchantDomain(current.merchant) ? <FaviconBadge size="lg" website={merchantDomain(current.merchant)!} /> : <span className="grid size-11 place-items-center rounded-full bg-muted text-sm font-semibold">{current.merchant.slice(0, 1)}</span>}
                  <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{current.merchant}</h2><p className="truncate text-sm text-muted-foreground">{current.accountName} · {current.dateLabel}</p></div>
                </div>
                <p className="my-10 text-center text-4xl font-semibold tracking-tight tabular-nums">{formatCurrency(Math.abs(current.amount), current.currency)}</p>
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/45 p-3">
                  <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Suggested category</p><div className="mt-1">{suggestedCategory ? <CategoryPill category={suggestedCategory} /> : null}</div></div>
                  {suggestedId !== current.categoryId ? <span className="text-xs text-primary">New suggestion</span> : null}
                </div>
              </m.article>
            ) : (
              <m.section
                animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
                className="rounded-3xl border border-border bg-card p-8 text-center shadow-sm"
                exit={reduce
                  ? { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }
                  : { opacity: 0, transform: "translateY(-4px) scale(0.99)", transition: { duration: 0.15, ease: EASE_OUT } }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px) scale(0.96)" }}
                key="review-complete"
                transition={{ duration: reduce ? 0.15 : 0.25, ease: EASE_SMOOTH_OUT }}
              >
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-[color-mix(in_oklab,var(--positive)_16%,transparent)] text-[var(--positive)]"><Check className="size-6" /></span>
                <h2 className="mt-4 text-xl font-semibold">Review complete</h2>
                <p className="mt-2 text-sm text-muted-foreground">{reviewed} reviewed · {recategorized} recategorized · {history.length - reviewed} skipped</p>
              </m.section>
            )}
          </AnimatePresence>
        </LazyMotion>

        <div className="mt-5 grid grid-cols-4 gap-2">
          <Button disabled={!current || busy} onClick={() => void advance("skip")} type="button" variant="outline"><ArrowLeft className="size-4" /><span className="hidden sm:inline">Skip</span></Button>
          <CategoryPicker categories={categories} onOpenChange={setPickerOpen} onSelect={(id) => void advance("categorize", id)} open={pickerOpen} value={current?.categoryId}>
            <Button disabled={!current || busy} type="button" variant="outline"><ArrowUp className="size-4" /><span className="hidden sm:inline">Category</span></Button>
          </CategoryPicker>
          <Button disabled={!current || busy} onClick={() => void advance("review")} type="button" variant="outline"><ArrowDown className="size-4" /><span className="hidden sm:inline">As-is</span></Button>
          <Button disabled={!current || busy} onClick={() => void advance("accept", suggestedId)} type="button"><ArrowRight className="size-4" /><span className="hidden sm:inline">Accept</span></Button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">J skip · K category · Enter accept · U undo</span>
          <Button disabled={history.length === 0 || busy} onClick={() => void undo()} size="sm" type="button" variant="ghost"><RotateCcw className="size-3.5" />Undo</Button>
        </div>
        {message ? <p aria-live="polite" className="mt-2 text-center text-xs text-[var(--negative)]">{message}</p> : null}
      </div>
    </main>
  );
}

function formatWeek(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  const start = new Date(value); start.setUTCDate(value.getUTCDate() - day);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${formatter.format(start)}–${formatter.format(end)}`;
}
