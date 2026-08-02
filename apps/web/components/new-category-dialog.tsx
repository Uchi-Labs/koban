"use client";

import { Search, Sparkles } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import React, { useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BlossomPicker } from "@/components/ui/blossom-picker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hexToRgb, oklchToHex } from "@/lib/bloom-color";
import {
  categoryColorPalette,
  filterFinanceEmojiOptions,
  inferCategoryEmoji,
  neutralCategoryEmoji
} from "@/lib/category-style";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The ring keeps the persisted palette on its outer edge; Bloom remains the
// arbitrary-color affordance for hex and shades between those anchors.
const DEFAULT_COLOR = categoryColorPalette[0];

type CategoryKind = "regular" | "excluded";

interface NewCategoryState {
  budget: string;
  busy: "save" | "suggest" | null;
  color: string;
  emoji: string;
  emojiOpen: boolean;
  emojiQuery: string;
  kind: CategoryKind;
  message: string;
  name: string;
  ringColor?: string;
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
  emojiQuery: "",
  kind: "regular",
  message: "",
  name: "",
  ringColor: DEFAULT_COLOR
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
  const { budget, busy, color, emoji, emojiOpen, emojiQuery, kind, message, name, ringColor } = state;

  const filteredEmojiOptions = useMemo(() => filterFinanceEmojiOptions(emojiQuery), [emojiQuery]);
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
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-[31rem]"
        showCloseButton
      >
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
              onClick={() => updateState({ emojiOpen: !emojiOpen, emojiQuery: "" })}
              type="button"
            >
              {/* `leading-none` + block: an inline span carries the font's line-height
                  and baseline, which pushes the glyph off the button's optical centre
                  even under place-items-center. */}
              <span aria-hidden="true" className="block text-center leading-none">
                {emoji}
              </span>
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
                    <label className="relative block border-b border-border p-2">
                      <Search
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                      <input
                        aria-label="Search emoji"
                        autoFocus
                        className="h-8 w-full rounded-xl bg-muted/60 pr-3 pl-8 text-sm outline-hidden transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
                        onChange={(event) => updateState({ emojiQuery: event.target.value })}
                        placeholder="Search emoji"
                        value={emojiQuery}
                      />
                    </label>
                    <ScrollArea
                      className="max-h-48"
                      viewportClassName="scroll-fade-y scroll-fade-sm h-fit max-h-48 overscroll-contain"
                    >
                      {filteredEmojiOptions.length > 0 ? (
                        <div className="grid grid-cols-6 gap-1 p-2">
                          {filteredEmojiOptions.map(({ emoji: option, keywords }) => (
                            <button
                              aria-label={`Use ${option}: ${keywords.join(", ")}`}
                              className="grid size-11 place-items-center rounded-lg text-base transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none sm:size-10"
                              key={option}
                              onClick={() => {
                                emojiTouchedRef.current = true;
                                updateState({ emoji: option, emojiOpen: false, emojiQuery: "" });
                              }}
                              type="button"
                            >
                              <span aria-hidden="true">{option}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No emoji found.</p>
                      )}
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
            <label className="flex flex-col items-center gap-0.5">
              <span className="flex items-baseline justify-center gap-1 text-2xl font-semibold tabular-nums">
                <span className="text-muted-foreground">$</span>
                <input
                  aria-label="Monthly budget"
                  // No placeholder: the input is centered, so a centered "0" glyph
                  // renders in the exact spot the caret lands — the caret appears to
                  // sit inside the zero. The visible label below carries the meaning.
                  className="w-24 bg-transparent text-center outline-hidden"
                  inputMode="decimal"
                  onChange={(event) => updateState({ budget: event.target.value.replace(/[^0-9.]/g, "") })}
                  value={budget}
                />
              </span>
              <span className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Monthly budget — optional</span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">Excluded categories are left out of spending totals and budgets.</p>
          )}

          {/* Single color control. The blossom reserves its own expanded footprint —
              `.bcp-root` is sized to the collapsed core, so without it the open bloom
              paints over the Save button. */}
          <div className="flex w-full flex-col items-center justify-center">
            <BlossomPicker
              ariaLabel="Category color"
              onChange={(nextColor) => updateState({ color: nextColor, ringColor: nextColor })}
              value={ringColor}
            />
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
