"use client";

import { Check, Sparkles } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import React, { useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BloomColorPicker } from "@/components/ui/bloom-color-picker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hexToRgb, oklchToHex } from "@/lib/bloom-color";
import { categoryColorPalette, financeEmojiOptions, inferCategoryEmoji, neutralCategoryEmoji } from "@/lib/category-style";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The registry now persists any structurally valid CSS color (hex, rgb/hsl,
// oklch/oklab — see isValidCssColor in lib/category-style.ts and
// assertValidRegistryColorInput in lib/db/finance-db.ts), not just these 12
// tokens. The strip stays the fast path for the common case; the Bloom picker
// next to it is the "any color" affordance.
const SWATCHES = [...categoryColorPalette];
const DEFAULT_COLOR = SWATCHES[0];

type CategoryKind = "regular" | "excluded";

interface NewCategoryState {
  budget: string;
  busy: "save" | "suggest" | null;
  color: string;
  emoji: string;
  emojiOpen: boolean;
  kind: CategoryKind;
  message: string;
  name: string;
}

type NewCategoryAction =
  | { type: "patch"; patch: Partial<NewCategoryState> }
  | { type: "reset" };

const INITIAL_NEW_CATEGORY_STATE: NewCategoryState = {
  budget: "",
  busy: null,
  color: DEFAULT_COLOR,
  emoji: neutralCategoryEmoji,
  emojiOpen: false,
  kind: "regular",
  message: "",
  name: ""
};

function newCategoryReducer(state: NewCategoryState, action: NewCategoryAction): NewCategoryState {
  if (action.type === "reset") {
    return INITIAL_NEW_CATEGORY_STATE;
  }

  return { ...state, ...action.patch };
}

export function NewCategoryDialog({
  aiSuggestionEnabled,
  aiSuggestionMessage,
  onCreated,
  onOpenChange,
  open,
  uncategorizedMerchants
}: {
  aiSuggestionEnabled: boolean;
  aiSuggestionMessage: string;
  onCreated?: (categoryId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  uncategorizedMerchants: string[];
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [state, dispatch] = React.useReducer(newCategoryReducer, INITIAL_NEW_CATEGORY_STATE);
  const emojiTouchedRef = useRef(false);
  const { budget, busy, color, emoji, emojiOpen, kind, message, name } = state;

  const saveTextColor = useMemo(() => readableTextColor(color), [color]);

  function updateState(patch: Partial<NewCategoryState>) {
    dispatch({ type: "patch", patch });
  }

  function reset() {
    emojiTouchedRef.current = false;
    dispatch({ type: "reset" });
  }

  function close() {
    onOpenChange(false);
    setTimeout(reset, 150);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      updateState({ message: "Give the category a name." });
      return;
    }
    updateState({ busy: "save", message: "" });

    const budgetAmount = kind === "regular" ? Number(budget.replace(/[$,\s]/g, "")) : NaN;

    try {
      const response = await fetch("/api/v1/categories", {
        body: JSON.stringify({
          budget_amount: Number.isFinite(budgetAmount) && budgetAmount > 0 ? budgetAmount : undefined,
          color,
          emoji,
          name: name.trim()
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as { error?: string; id?: string };

      if (!response.ok || !body.id) {
        throw new Error(body.error ?? "Unable to create category.");
      }

      onCreated?.(body.id);
      router.refresh();
      close();
    } catch (error) {
      updateState({ message: error instanceof Error ? error.message : "Unable to create category." });
    } finally {
      updateState({ busy: null });
    }
  }

  async function suggest() {
    updateState({ busy: "suggest", message: "" });
    try {
      const response = await fetch("/api/v1/categories/suggestions", {
        body: JSON.stringify({ description: name, merchants: uncategorizedMerchants }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as {
        completed: boolean;
        error_message?: string;
        suggestions: Array<{ emoji: string; name: string }>;
      };
      const first = body.suggestions?.[0];
      if (first) {
        emojiTouchedRef.current = true;
        updateState({
          emoji: first.emoji,
          message: body.completed ? "Suggested from your uncategorized merchants." : body.error_message ?? "",
          name: first.name
        });
      } else {
        updateState({ message: body.error_message ?? "No suggestion available." });
      }
    } catch (error) {
      updateState({ message: error instanceof Error ? error.message : "Unable to suggest a category." });
    } finally {
      updateState({ busy: null });
    }
  }

  return (
    <Dialog onOpenChange={(next) => (next ? onOpenChange(true) : close())} open={open}>
      <DialogContent className="sm:max-w-[26rem]" showCloseButton>
        <form className="flex flex-col items-center gap-5" onSubmit={save}>
          <DialogTitle className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">New category</DialogTitle>

          <div className="grid w-full grid-cols-2 gap-1 rounded-full bg-muted/60 p-1">
            {(["regular", "excluded"] as const).map((value) => (
              <button
                className={cn(
                  "h-8 rounded-full text-sm font-medium transition-colors",
                  kind === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
                key={value}
                onClick={() => updateState({ kind: value })}
                type="button"
              >
                {value === "regular" ? "Regular" : "Excluded"}
              </button>
            ))}
          </div>

          <div className="relative flex flex-col items-center gap-2">
            <button
              aria-label="Choose emoji"
              className="grid size-14 place-items-center rounded-2xl border border-border bg-muted/40 text-3xl transition-colors hover:bg-muted"
              onClick={() => updateState({ emojiOpen: !emojiOpen })}
              type="button"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
            <LazyMotion features={domAnimation}>
              <AnimatePresence initial={false}>
                {emojiOpen ? (
                  <m.div
                    animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
                    className="absolute top-16 z-30 w-72 origin-top overflow-hidden rounded-2xl border border-border bg-popover shadow-lg"
                    exit={reduce
                      ? { opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }
                      : { opacity: 0, transform: "translateY(0) scale(0.99)", transition: { duration: 0.1, ease: EASE_OUT } }}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(-4px) scale(0.96)" }}
                    transition={{ duration: reduce ? 0.1 : 0.15, ease: EASE_OUT }}
                  >
                    <ScrollArea
                      className="max-h-56"
                      viewportClassName="scroll-fade-y scroll-fade-sm h-fit max-h-56 overscroll-contain"
                    >
                      <div className="grid grid-cols-6 gap-1 p-2">
                        {financeEmojiOptions.map((option, index) => (
                          <button
                            aria-label={`Use ${option}`}
                            className="grid size-11 place-items-center rounded-lg text-base transition-colors hover:bg-muted motion-reduce:transition-none sm:size-10"
                            key={`${option}-${index}`}
                            onClick={() => {
                              emojiTouchedRef.current = true;
                              updateState({ emoji: option, emojiOpen: false });
                            }}
                            type="button"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                  </m.div>
                ) : null}
              </AnimatePresence>
            </LazyMotion>
          </div>

          <input
            aria-label="Category name"
            className="w-full bg-transparent text-center text-xl font-semibold tracking-tight outline-hidden placeholder:text-muted-foreground/60"
            onChange={(event) => {
              const next = event.target.value;
              const patch: Partial<NewCategoryState> = { name: next };
              if (!emojiTouchedRef.current) {
                patch.emoji = inferCategoryEmoji(next);
              }
              updateState(patch);
            }}
            placeholder="Category name"
            style={{ color: nameTint(color) }}
            value={name}
          />

          {kind === "regular" ? (
            <label className="flex items-baseline justify-center gap-1 text-2xl font-semibold tabular-nums">
              <span className="text-muted-foreground">$</span>
              <input
                aria-label="Monthly budget"
                className="w-24 bg-transparent text-center outline-hidden placeholder:text-muted-foreground/50"
                inputMode="decimal"
                onChange={(event) => updateState({ budget: event.target.value.replace(/[^0-9.]/g, "") })}
                placeholder="0"
                value={budget}
              />
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">Excluded categories are left out of spending totals and budgets.</p>
          )}

          <div className="flex w-full items-center gap-2">
            <div
              className="flex flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain"
              onWheel={(event) => {
                // Map the (dominant) vertical wheel axis onto horizontal scroll
                // so a plain scrollwheel can move through the swatches.
                const el = event.currentTarget;
                if (el.scrollWidth <= el.clientWidth) return;
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                  el.scrollLeft += event.deltaY;
                }
              }}
            >
              {SWATCHES.map((swatch) => {
                const selected = swatch === color;
                return (
                  <button
                    aria-label={`Use color ${swatch}`}
                    aria-pressed={selected}
                    className="grid h-11 w-5 shrink-0 flex-1 place-items-center rounded-full transition-transform [@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 motion-reduce:transition-none sm:h-10"
                    key={swatch}
                    onClick={() => updateState({ color: swatch })}
                    style={{ backgroundColor: swatch }}
                    type="button"
                  >
                    {selected ? <Check className="size-3.5 text-white drop-shadow" strokeWidth={3} /> : null}
                  </button>
                );
              })}
            </div>
            <div className="h-5 w-px bg-border" />
            <BloomColorPicker ariaLabel="Custom category color" onChange={(nextColor) => updateState({ color: nextColor })} value={color} />
          </div>

          <button
            className="h-11 w-full rounded-2xl text-sm font-semibold tracking-wide uppercase shadow-[var(--ic-card-rest-shadow)] transition-[filter] hover:brightness-110 disabled:opacity-60"
            disabled={busy === "save"}
            style={{ backgroundColor: color, color: saveTextColor }}
            type="submit"
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>

          <div className="flex min-h-4 w-full items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">{message}</span>
            <button
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:text-foreground disabled:opacity-50"
              disabled={busy === "suggest" || !aiSuggestionEnabled}
              onClick={suggest}
              title={aiSuggestionEnabled ? "Suggest a name and emoji" : aiSuggestionMessage}
              type="button"
            >
              <Sparkles className="size-3.5" />
              {busy === "suggest" ? "Thinking…" : "Suggest"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function readableTextColor(color: string): string {
  const hex = /^oklch\(/i.test(color) ? oklchToHex(color) : color;
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) {
    return "#0b0b0b";
  }
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.62 ? "#0b0b0b" : "#ffffff";
}

function nameTint(color: string): string {
  return `color-mix(in oklab, ${color} 82%, var(--foreground))`;
}
