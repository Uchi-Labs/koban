"use client";

import { FileText, Loader2, MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { ItemizedLines } from "@/components/itemized-lines";
import { Button } from "@/components/ui/button";
import type { ReviewQueueContext } from "@/lib/db/finance-db";

export type ReviewContext = ReviewQueueContext;

/**
 * Context behind a review card: why the category was chosen, what documents
 * back it, and a field for the correction the model should apply next pass.
 *
 * Pointer events stop here so dragging inside the note never swipes the card
 * away mid-sentence.
 *
 * When the model was unsure, the note field starts open so the ask is visible,
 * but unfocused: the j / k / Enter review shortcuts keep working until the
 * user clicks into it.
 */
export function ReviewContextPanel({
  context,
  transactionId,
  unsure = false
}: {
  context: ReviewContext | undefined;
  transactionId: string;
  unsure?: boolean;
}) {
  const [open, setOpen] = useState(unsure);
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState("");

  const notes = [...(context?.notes ?? []), ...saved];

  async function save() {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transactionId)}/context-notes`, {
        body: JSON.stringify({ body }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error("Could not save that note.");
      setSaved((items) => [...items, body]);
      setDraft("");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="mt-4 space-y-3 border-t border-border/50 pt-4 text-left"
      onPointerDownCapture={(event) => event.stopPropagation()}
    >
      {context?.reason ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Filed here because</span> {context.reason}
        </p>
      ) : null}

      {context?.evidence.length ? (
        <ul className="space-y-1.5">
          {context.evidence.slice(0, 3).map((item, index) => (
            <li className="flex gap-2 text-xs text-muted-foreground" key={`${item.title}-${index}`}>
              <FileText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{item.title}</span>
                <span className="block truncate">{item.sourceLabel} · {Math.round(item.confidence * 100)}% match</span>
                {item.lines?.length ? <ItemizedLines className="mt-1" lines={item.lines} /> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No receipt or email is attached to this one.</p>
      )}

      {notes.length ? (
        <ul className="space-y-1">
          {notes.map((note, index) => (
            <li className="rounded-lg bg-muted/50 px-3 py-2 text-xs" key={`${note}-${index}`}>{note}</li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="space-y-2">
          {unsure ? <p className="text-xs font-medium">Not sure about this one. What is it?</p> : null}
          <textarea
            aria-label="Context for this transaction"
            autoFocus={focusOnOpen}
            className="w-full select-text resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="What is this actually? Anything you write here is queued for the next refinement pass."
            rows={3}
            value={draft}
          />
          <div className="flex gap-2">
            <Button disabled={saving || !draft.trim()} onClick={() => void save()} size="sm" type="button">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Queue for next pass
            </Button>
            <Button onClick={() => { setOpen(false); setDraft(""); }} size="sm" type="button" variant="ghost">Cancel</Button>
          </div>
        </div>
      ) : (
        <Button className="w-full" onClick={() => { setFocusOnOpen(true); setOpen(true); }} size="sm" type="button" variant="outline">
          <MessageSquarePlus className="size-3.5" />
          Add context
        </Button>
      )}

      {error ? <p aria-live="polite" className="text-xs text-[var(--negative)]">{error}</p> : null}
    </div>
  );
}
