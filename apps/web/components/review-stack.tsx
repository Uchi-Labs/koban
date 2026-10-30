"use client";

import type { Category } from "@ai-finances/schema";
import { ArrowLeft, ArrowRight, Check, CircleHelp, RotateCcw } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion, type PanInfo } from "motion/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CategoryPill } from "@/components/category-pill";
import { isUnsure, reviewConfidenceFor, type ReviewConfidence } from "@/components/review-confidence";
import { ReviewContextPanel, type ReviewContext } from "@/components/review-context-panel";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/ui/category-picker";
import { FaviconBadge } from "@/components/ui/favicon-badge";
import { RollingDigits } from "@/components/ui/rolling-digits";
import { formatCurrency } from "@/lib/format";
import { merchantDomain } from "@/lib/merchant-domain";
import { EASE_OUT, EASE_SMOOTH_OUT, SPRING_LAYOUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TransactionView } from "@/lib/view-models";

type ReviewAction = "accept" | "categorize" | "review" | "skip";
interface HistoryItem { action: ReviewAction; categoryId: string; previousCategoryId: string; transactionId: string }

export function ReviewStack({ categories, confidences, contexts, initialTransactions, suggestions }: {
  categories: Category[];
  /** Model confidence (0-1) of each pending category suggestion, by transaction id. */
  confidences?: Record<string, number>;
  contexts?: Record<string, ReviewContext>;
  initialTransactions: TransactionView[];
  suggestions: Record<string, string>;
}) {
  const reduce = useReducedMotion();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * Category chosen on the card, per transaction.
   *
   * `suggestions` is a read-only prop of what the model proposed, so a user
   * pick needs somewhere to live until Accept commits it. Keyed by id rather
   * than held as one value, so a pick survives the card behind it being
   * promoted, and an Undo that walks back to a card keeps what was chosen.
   */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Which card is leaving, and in which direction. Deliberately NOT cleared
  // after the swipe: AnimatePresence reads the exit prop from the removal
  // render, so the vector must survive that render. The id gate keeps it from
  // ever touching another card; undo clears it so the card can return.
  const [exiting, setExiting] = useState<{ id: string; x: number; y: number } | null>(null);
  const current = initialTransactions[history.length];
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const suggestedId = current ? chosen[current.id] ?? suggestions[current.id] ?? current.categoryId : undefined;
  const reviewed = history.filter((item) => item.action !== "skip").length;
  const recategorized = history.filter((item) => item.action === "categorize" || (item.action === "accept" && item.categoryId !== item.previousCategoryId)).length;
  const reviewProgress = initialTransactions.length === 0 ? 100 : (history.length / initialTransactions.length) * 100;
  const confidenceFor = useCallback(
    (id: string) => reviewConfidenceFor(suggestions[id] ? { categoryId: suggestions[id], confidence: confidences?.[id] } : undefined),
    [confidences, suggestions]
  );

  const advance = useCallback(async (action: ReviewAction, categoryId?: string) => {
    if (!current || busy) return;
    const targetCategoryId = categoryId ?? current.categoryId;
    setBusy(true);
    setMessage("");
    const vector = action === "skip" ? { x: -520, y: 0 } : action === "categorize" ? { x: 0, y: -520 } : action === "review" ? { x: 0, y: 520 } : { x: 520, y: 0 };
    setExiting({ id: current.id, ...vector });
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
      setExiting(null);
      setMessage(error instanceof Error ? error.message : "Unable to save this review.");
    } finally {
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
      setExiting(null);
      setHistory((items) => items.slice(0, -1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to undo the last review.");
    } finally { setBusy(false); }
  }, [busy, history]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (pickerOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      // Never hijack real typing: bail when focus is in an editable element or
      // any dialog (e.g. New category) is open above the stack.
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      }
      if (event.key === "j") { event.preventDefault(); void advance("skip"); }
      else if (event.key === "k") { event.preventDefault(); setPickerOpen(true); }
      else if (event.key === "Enter") { event.preventDefault(); void advance("accept", suggestedId); }
      else if (event.key.toLowerCase() === "u") { event.preventDefault(); void undo(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, pickerOpen, suggestedId, undo]);

  // Trackpad scroll moves the front card like a drag: the accumulated wheel
  // delta pulls the card (content follows fingers), crossing the same 115px
  // threshold fires the same action, and an idle timeout springs it back.
  const stackRef = useRef<HTMLDivElement | null>(null);
  const wheelRef = useRef<{ fired: boolean; timer: ReturnType<typeof setTimeout> | null; x: number; y: number }>({ fired: false, timer: null, x: 0, y: 0 });
  const [wheelPull, setWheelPull] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if (!current || busy || pickerOpen) return;
      // Scrolling inside the context note scrolls the note, not the card.
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
      // Native non-passive listener: React's onWheel is passive, and the page
      // must not scroll while the gesture is steering the card.
      event.preventDefault();
      const wheel = wheelRef.current;
      if (wheel.timer) clearTimeout(wheel.timer);
      if (!wheel.fired) {
        wheel.x -= event.deltaX;
        wheel.y -= event.deltaY;
        if (Math.abs(wheel.x) > Math.abs(wheel.y) && Math.abs(wheel.x) > 115) {
          wheel.fired = true;
          void advance(wheel.x > 0 ? "accept" : "skip", wheel.x > 0 ? suggestedId : undefined);
        } else if (Math.abs(wheel.y) > 115) {
          // Vertical scroll always skips, in either direction. It used to steer
          // the card the way a drag does — up opened the category picker, down
          // marked as-is — but a trackpad flick is a "move past this" gesture,
          // not a considered choice, and landing in a category picker from an
          // idle scroll reads as the app misfiring. Category and As-is stay on
          // the buttons and the K / arrow keys, where the intent is explicit.
          wheel.fired = true;
          void advance("skip");
        }
        setWheelPull(wheel.fired ? null : { x: wheel.x, y: wheel.y });
      }
      wheel.timer = setTimeout(() => {
        wheelRef.current = { fired: false, timer: null, x: 0, y: 0 };
        setWheelPull(null);
      }, 140);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelRef.current.timer) clearTimeout(wheelRef.current.timer);
    };
  }, [advance, busy, current, pickerOpen, suggestedId]);

  function onDragEnd(_event: PointerEvent, info: PanInfo) {
    const projectedX = info.offset.x + info.velocity.x * 0.16;
    const projectedY = info.offset.y + info.velocity.y * 0.16;
    if (Math.abs(projectedX) > Math.abs(projectedY) && Math.abs(projectedX) > 115) {
      void advance(projectedX > 0 ? "accept" : "skip", projectedX > 0 ? suggestedId : undefined);
    } else if (projectedY < -115) setPickerOpen(true);
    else if (projectedY > 115) void advance("review");
  }

  const weekLabel = current ? formatWeek(current.date) : "Review complete";
  // Visible card stack: the front card plus up to two peeking behind it.
  const stack = initialTransactions.slice(history.length, history.length + 3);
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col px-4 py-5 md:px-6" data-testid="review-page">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div><h1 className="app-page-title">Review transactions</h1><p className="mt-1.5 text-sm text-muted-foreground">{weekLabel}</p></div>
        <div
          aria-label={`${history.length} of ${initialTransactions.length} reviewed`}
          aria-live="polite"
          className="inline-flex min-h-8 shrink-0 items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium tabular-nums"
        >
          <span
            aria-hidden="true"
            className="review-progress-pie relative size-4 shrink-0 rounded-full text-primary"
            style={{ "--review-pie": `${reviewProgress}%` } as CSSProperties}
          />
          <span aria-hidden="true" className="inline-flex items-center gap-1">
            <RollingDigits ariaLive={false} coalesceUpdates startOnView={false} value={history.length} />
            <span>of {initialTransactions.length.toLocaleString()} reviewed</span>
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center" ref={stackRef}>
        <LazyMotion features={domAnimation}>
          {/* The stack wrapper is the positioning context: the invisible
              in-flow copy of the front card sizes it, and every animated card
              is an absolute overlay inside it — exits and promotions never
              disturb the page layout below. */}
          <div className="relative">
          {current ? (
            <div aria-hidden="true" className="invisible rounded-3xl border p-6" key={current.id}>
              <CardBody confidence={confidenceFor(current.id)} context={contexts?.[current.id]} showContext suggestedCategory={categoryById.get(suggestedId ?? current.categoryId) ?? current.category} suggestedId={suggestedId ?? current.categoryId} transaction={current} />
            </div>
          ) : null}
          <AnimatePresence initial={false}>
            {stack.length > 0 ? (
              stack.map((transaction, depth) => {
                const front = depth === 0;
                const cardSuggestedId = chosen[transaction.id] ?? suggestions[transaction.id] ?? transaction.categoryId;
                const cardSuggestedCategory = categoryById.get(cardSuggestedId) ?? transaction.category;
                const leaving = exiting?.id === transaction.id;
                // Depth pose: each step back lifts, shrinks, fades, and blurs a
                // touch — the "stack with a fade" read. Reduced motion keeps the
                // stack legible but skips the offsets.
                const pull = front && !reduce && !leaving ? wheelPull : null;
                const pose = reduce
                  ? { filter: "blur(0px)", opacity: front ? 1 : 0, rotate: 0, scale: 1, x: 0, y: 0 }
                  : {
                      filter: `blur(${depth * 1.25}px)`,
                      opacity: 1 - depth * 0.3,
                      rotate: pull ? pull.x * 0.02 : 0,
                      scale: 1 - depth * 0.05,
                      x: pull ? pull.x : 0,
                      y: (pull ? pull.y : 0) + depth * -16
                    };
                return (
                  <m.article
                    animate={pose}
                    aria-hidden={front ? undefined : true}
                    className={cn(
                      "absolute inset-x-0 top-0 touch-none select-none rounded-3xl border border-border bg-card p-6",
                      front ? "shadow-xl" : "pointer-events-none"
                    )}
                    drag={front && !busy}
                    dragConstraints={{ bottom: 0, left: 0, right: 0, top: 0 }}
                    dragElastic={0.72}
                    dragMomentum={false}
                    exit={reduce
                      ? { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }
                      : leaving && exiting
                        ? {
                            opacity: 0,
                            rotate: exiting.x === 0 ? 0 : Math.sign(exiting.x) * 9,
                            transition: { duration: 0.32, ease: EASE_SMOOTH_OUT },
                            x: exiting.x,
                            y: exiting.y
                          }
                        : { opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: EASE_OUT } }}
                    initial={front
                      ? (reduce ? false : { opacity: 0, scale: 0.96, y: 12 })
                      : (reduce ? false : { filter: "blur(3px)", opacity: 0, scale: 0.88, y: -34 })}
                    key={transaction.id}
                    onDragEnd={front ? onDragEnd : undefined}
                    style={{ zIndex: stack.length - depth }}
                    transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                    whileDrag={front ? { cursor: "grabbing", rotate: 1.5, scale: 1.015 } : undefined}
                  >
                    <CardBody
                      categoryControl={
                        front && cardSuggestedCategory ? (
                          <CategoryPicker
                            categories={categories}
                            onOpenChange={setPickerOpen}
                            onSelect={(id) => setChosen((all) => ({ ...all, [transaction.id]: id }))}
                            open={pickerOpen}
                            value={cardSuggestedId}
                          >
                            <button
                              aria-label={`Category: ${cardSuggestedCategory.name}. Change it.`}
                              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              disabled={busy}
                              type="button"
                            >
                              <CategoryPill category={cardSuggestedCategory} />
                            </button>
                          </CategoryPicker>
                        ) : undefined
                      }
                      confidence={confidenceFor(transaction.id)}
                      context={contexts?.[transaction.id]}
                      showContext={front}
                      suggestedCategory={cardSuggestedCategory}
                      suggestedId={cardSuggestedId}
                      transaction={transaction}
                    />
                  </m.article>
                );
              })
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
          </div>
        </LazyMotion>

        {/* Two actions, because there were only ever two decisions.
            "Category" was a button that opened a picker for a value displayed
            six inches above it, and "As-is" sent a request identical to Accept
            whenever the suggestion matched the current category -- differing
            only when it did not, with nothing on screen saying which case you
            were in. The pill is now the category, so Accept commits whatever it
            shows and leaving it alone IS as-is. */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button disabled={!current || busy} onClick={() => void advance("skip")} type="button" variant="outline"><ArrowLeft className="size-4" /><span className="hidden sm:inline">Skip</span></Button>
          <Button disabled={!current || busy} onClick={() => void advance("accept", suggestedId)} type="button"><ArrowRight className="size-4" /><span className="hidden sm:inline">Accept</span></Button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          {/* The wheel gesture had no affordance at all — nothing on screen said
              the card was scrollable, so the only way to discover it was to
              trigger it by accident. */}
          <span className="hidden sm:inline">Scroll or drag to skip · J skip · K category · Enter accept · U undo</span>
          <Button disabled={history.length === 0 || busy} onClick={() => void undo()} size="sm" type="button" variant="ghost"><RotateCcw className="size-3.5" />Undo</Button>
        </div>
        {message ? <p aria-live="polite" className="mt-2 text-center text-xs text-[var(--negative)]">{message}</p> : null}
      </div>
    </main>
  );
}

function CardBody({ categoryControl, confidence, context, showContext, suggestedCategory, suggestedId, transaction }: {
  confidence: ReviewConfidence;
  context?: ReviewContext;
  showContext?: boolean;
  /**
   * The category pill, wrapped so it opens the picker.
   *
   * Only the front card gets one; the cards stacked behind it render a plain
   * pill, because they are decoration and an interactive control the user
   * cannot see is a keyboard trap.
   */
  categoryControl?: React.ReactNode;
  suggestedCategory: Category | undefined;
  suggestedId: string;
  transaction: TransactionView;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        {merchantDomain(transaction.merchant) ? <FaviconBadge size="lg" website={merchantDomain(transaction.merchant)!} /> : <span className="grid size-11 place-items-center rounded-full bg-muted text-sm font-semibold">{transaction.merchant.slice(0, 1)}</span>}
        <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{transaction.merchant}</h2><p className="truncate text-sm text-muted-foreground">{transaction.accountName} · {transaction.dateLabel}</p></div>
      </div>
      <p className="my-10 text-center text-4xl font-semibold tracking-tight tabular-nums">{formatCurrency(Math.abs(transaction.amount), transaction.currency)}</p>
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/45 p-3">
        <div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Category</p><div className="mt-1">{categoryControl ?? (suggestedCategory ? <CategoryPill category={suggestedCategory} /> : null)}</div></div>
        <div className="flex flex-col items-end gap-1 text-right">
          {suggestedId !== transaction.categoryId ? <span className="text-xs text-primary">New suggestion</span> : null}
          {isUnsure(confidence) ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CircleHelp aria-hidden="true" className="size-3.5" />
              {confidence.kind === "low" ? <span>Not sure · <span className="tabular-nums">{Math.round(confidence.score * 100)}%</span></span> : "No AI suggestion"}
            </span>
          ) : null}
        </div>
      </div>
      {showContext ? <ReviewContextPanel context={context} transactionId={transaction.id} unsure={isUnsure(confidence)} /> : null}
    </>
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
