"use client";

import { Archive, Check, Lock, Trash2 } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { CategoryPill } from "@/components/category-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BlossomPicker } from "@/components/ui/blossom-picker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { categoryColorPalette, financeEmojiOptions, inferCategoryEmoji, neutralCategoryEmoji } from "@/lib/category-style";
import { EASE_OUT } from "@/lib/motion";

// The registry persists any structurally valid CSS color (hex, rgb/hsl,
// oklch/oklab — see isValidCssColor in lib/category-style.ts), not just these
// 12 tokens. The palette stays the fast path; the Bloom picker below is the
// "any color" affordance.
const PALETTE = [...categoryColorPalette];

export interface EditableCategory {
  archived: boolean;
  budgetAmount?: number;
  color: string;
  emoji: string;
  id: string;
  isBuiltIn: boolean;
  name: string;
  sortOrder: number;
}

export function CategoryEditDialog({
  categories,
  category,
  onOpenChange,
  open
}: {
  categories: EditableCategory[];
  category: EditableCategory;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [emojiDraft, setEmojiDraft] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [largeBudgetConfirmed, setLargeBudgetConfirmed] = useState(false);
  const [replacementId, setReplacementId] = useState("cat_other");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "archive" | "delete" | null>(null);
  const [message, setMessage] = useState("");
  const name = nameDraft ?? category.name;
  const emoji = (emojiDraft ?? category.emoji) || neutralCategoryEmoji;
  const color = colorDraft ?? category.color;
  const budget = budgetDraft ?? (category.budgetAmount ? formatBudget(category.budgetAmount) : "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage("Category name is required.");
      return;
    }
    setMessage("");
    const budgetAmount = Number(budget.replace(/[$,\s]/g, ""));
    if (budgetAmount > 20_000 && !largeBudgetConfirmed) {
      setLargeBudgetConfirmed(true);
      setMessage("That monthly budget is over $20,000. Save again to confirm.");
      return;
    }
    setBusy("save");

    try {
      const response = await fetch(`/api/v1/categories/${encodeURIComponent(category.id)}`, {
        body: JSON.stringify({
          budget_amount: budget.trim() === "" ? null : Number.isFinite(budgetAmount) && budgetAmount > 0 ? budgetAmount : null,
          color,
          emoji,
          name: name.trim()
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save category.");
      }
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save category.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleArchive() {
    setBusy("archive");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/categories/${encodeURIComponent(category.id)}`, {
        body: JSON.stringify({ archived: !category.archived }), headers: { "Content-Type": "application/json" }, method: "PATCH"
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to update category visibility.");
      }
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update category visibility.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/categories/${encodeURIComponent(category.id)}`, {
        body: JSON.stringify({ reassign_to: replacementId }), headers: { "Content-Type": "application/json" }, method: "DELETE"
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to delete category.");
      }
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete category.");
    } finally { setBusy(null); }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={save}>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                aria-label="Choose emoji"
                className="text-base"
                onClick={() => setEmojiOpen((current) => !current)}
                size="icon"
                type="button"
                variant="outline"
              >
                <span aria-hidden="true">{emoji}</span>
              </Button>
              <LazyMotion features={domAnimation}>
                <AnimatePresence initial={false}>
                  {emojiOpen ? (
                    <m.div
                      animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
                      className="absolute top-11 left-0 z-30 w-72 origin-top-left overflow-hidden rounded-2xl border border-border bg-popover shadow-lg"
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
                                setEmojiDraft(option);
                                setEmojiOpen(false);
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
            <Input
              aria-label="Category name"
              className="h-9"
              onChange={(event) => {
                const next = event.target.value;
                setNameDraft(next);
                if (emoji === neutralCategoryEmoji) {
                  setEmojiDraft(inferCategoryEmoji(next));
                }
              }}
              placeholder="Category name"
              value={name}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Color</span>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-1">
                {PALETTE.map((swatch) => (
                  <button
                    aria-label={`Use color ${swatch}`}
                    aria-pressed={swatch === color}
                    className="grid h-11 flex-1 place-items-center rounded-full transition-transform [@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 motion-reduce:transition-none sm:h-10"
                    key={swatch}
                    onClick={() => setColorDraft(swatch)}
                    style={{ backgroundColor: swatch }}
                    type="button"
                  >
                    {swatch === color ? <Check className="size-3.5 text-white drop-shadow" strokeWidth={3} /> : null}
                  </button>
                ))}
              </div>
              <div className="h-5 w-px bg-border" />
              {/* The same control as Settings and the new-category dialog. This
                  was the last call site still on the older BloomColorPicker, so
                  the app offered two different custom-colour pickers depending on
                  where you opened it. Identical props, so this is a swap. */}
              <BlossomPicker ariaLabel="Custom category color" onChange={setColorDraft} value={color} />
            </div>
          </div>

          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Monthly budget</span>
            <span className="flex items-center gap-1 rounded-lg border border-border bg-input/40 px-2.5 py-1.5 text-sm tabular-nums">
              <span className="text-muted-foreground">$</span>
              <input
                aria-label="Monthly budget"
                className="w-20 bg-transparent text-right outline-hidden placeholder:text-muted-foreground/50"
                inputMode="decimal"
                onChange={(event) => {
                  setLargeBudgetConfirmed(false);
                  setBudgetDraft(formatBudgetDraft(event.target.value));
                }}
                placeholder="None"
                value={budget}
              />
            </span>
          </label>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">Preview</span>
            <CategoryPill category={{ archived: false, color, emoji, icon: "circle", id: category.id, name: name || category.name, sortOrder: 0 }} />
          </div>

          <details className="rounded-lg border border-border/60 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium tracking-wide text-muted-foreground uppercase select-none">Advanced</summary>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Mapping ID</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{category.id}</code>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Renaming or recoloring never changes this ID, so provider metadata and existing transactions keep mapping through.
            </p>
            {category.isBuiltIn ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" />System category — it can be hidden, but not deleted.</p> : (
              <div className="mt-3 grid gap-2 border-t border-border/60 pt-3">
                <label className="grid gap-1 text-xs text-muted-foreground">Reassign transactions before deleting
                  <select className="h-9 rounded-lg border border-border bg-background px-2 text-foreground" onChange={(event) => setReplacementId(event.target.value)} value={replacementId}>
                    {categories.filter((item) => !item.archived && item.id !== category.id).map((item) => <option key={item.id} value={item.id}>{item.emoji} {item.name}</option>)}
                  </select>
                </label>
                <Button disabled={busy !== null} onClick={() => void remove()} size="sm" type="button" variant="destructive"><Trash2 className="size-4" />Delete category</Button>
              </div>
            )}
          </details>

          {message ? (
            <p aria-live="polite" className="text-xs text-[var(--negative)]">
              {message}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <Button disabled={busy !== null} onClick={toggleArchive} size="sm" type="button" variant="ghost">
                <Archive className="size-4" />
                {category.archived ? "Restore" : "Hide"}
              </Button>
            <div className="flex items-center gap-2">
              <Button onClick={() => onOpenChange(false)} size="sm" type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={busy === "save"} size="sm" type="submit">
                <Check className="size-4" />
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatBudget(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatBudgetDraft(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const [whole = "", ...decimalParts] = cleaned.split(".");
  const grouped = Number.parseInt(whole || "0", 10).toLocaleString("en-US");
  return decimalParts.length > 0 ? `${grouped}.${decimalParts.join("").slice(0, 2)}` : grouped;
}
