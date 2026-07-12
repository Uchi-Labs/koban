"use client";

import { Archive, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { CategoryPill } from "@/components/category-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BloomColorPicker } from "@/components/ui/bloom-color-picker";
import { categoryColorPalette, financeEmojiOptions, inferCategoryEmoji, neutralCategoryEmoji } from "@/lib/category-style";

// The registry persists any structurally valid CSS color (hex, rgb/hsl,
// oklch/oklab — see isValidCssColor in lib/category-style.ts), not just these
// 12 tokens. The palette stays the fast path; the Bloom picker below is the
// "any color" affordance.
const PALETTE = [...categoryColorPalette];

export interface EditableCategory {
  budgetAmount?: number;
  color: string;
  emoji: string;
  id: string;
  isBuiltIn: boolean;
  name: string;
}

export function CategoryEditDialog({
  category,
  onOpenChange,
  open
}: {
  category: EditableCategory;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const router = useRouter();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [emojiDraft, setEmojiDraft] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "archive" | null>(null);
  const [message, setMessage] = useState("");
  const name = nameDraft ?? category.name;
  const emoji = (emojiDraft ?? category.emoji) || neutralCategoryEmoji;
  const color = colorDraft ?? category.color;
  const budget = budgetDraft ?? (category.budgetAmount ? String(category.budgetAmount) : "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage("Category name is required.");
      return;
    }
    setBusy("save");
    setMessage("");
    const budgetAmount = Number(budget.replace(/[$,\s]/g, ""));

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

  async function archive() {
    setBusy("archive");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/categories/${encodeURIComponent(category.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Unable to archive category.");
      }
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to archive category.");
    } finally {
      setBusy(null);
    }
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
              {emojiOpen ? (
                <div className="scroll-fade-sm absolute top-11 left-0 z-30 grid max-h-56 w-72 grid-cols-9 gap-1 overflow-y-auto rounded-2xl border border-border bg-popover p-2 shadow-lg">
                  {financeEmojiOptions.map((option, index) => (
                    <button
                      aria-label={`Use ${option}`}
                      className="grid size-7 place-items-center rounded-lg text-base transition-colors hover:bg-muted"
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
              ) : null}
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
                    className="grid h-7 flex-1 place-items-center rounded-full transition-transform hover:scale-110 motion-reduce:hover:scale-100"
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
              <BloomColorPicker ariaLabel="Custom category color" onChange={setColorDraft} value={color} />
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
              onChange={(event) => setBudgetDraft(event.target.value.replace(/[^0-9.]/g, ""))}
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
          </details>

          {message ? (
            <p aria-live="polite" className="text-xs text-[var(--negative)]">
              {message}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            {!category.isBuiltIn ? (
              <Button disabled={busy !== null} onClick={archive} size="sm" type="button" variant="ghost">
                <Archive className="size-4" />
                Archive
              </Button>
            ) : (
              <span />
            )}
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
