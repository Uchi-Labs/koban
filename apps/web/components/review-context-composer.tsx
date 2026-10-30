"use client";

import { ArrowUp } from "lucide-react";
import * as React from "react";
import { DictationButton } from "@/components/dictation-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isPublicDemoClient } from "@/lib/agent-conversations-local";
import { saveDemoContext } from "@/lib/demo-context-local";
import { cn } from "@/lib/utils";

/**
 * Adds context to the transaction under review, on top of whatever context it
 * already has (from connectors, earlier notes, or Koban). Typed or dictated;
 * Enter saves, Shift+Enter adds a line. Saving goes through the same
 * context-note endpoint as the Transactions inspector, so the note is linked
 * as evidence and the agent can read it.
 */
export function ReviewContextComposer({ existing, onSaved, transactionId }: {
  existing: string | undefined;
  onSaved: (context: string) => void;
  transactionId: string;
}) {
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const demo = isPublicDemoClient();
  const trimmed = draft.trim();

  async function save() {
    if (!trimmed || saving) return;
    const combined = existing?.trim() ? `${existing.trim()}\n\n${trimmed}` : trimmed;
    setSaving(true);
    setError("");
    try {
      if (demo) {
        saveDemoContext(transactionId, combined);
        onSaved(combined);
      } else {
        const response = await fetch(`/api/v1/transactions/${encodeURIComponent(transactionId)}/context-notes`, {
          body: JSON.stringify({ body: combined }),
          headers: { "Content-Type": "application/json" },
          method: "POST"
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string; transaction?: { notes?: string } };
        if (!response.ok) throw new Error(body.error ?? "Unable to save this context.");
        onSaved(body.transaction?.notes ?? combined);
      }
      setDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this context.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-end gap-1 rounded-xl border border-border bg-card px-2 py-1.5 transition-colors focus-within:border-ring/60">
        <textarea
          aria-label="Add context"
          className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
          disabled={saving}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={existing?.trim() ? "Add more context…" : "Add context: who it was for, what it was part of…"}
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        <DictationButton
          disabled={saving}
          onText={(text) => {
            setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
            textareaRef.current?.focus();
          }}
        />
        <Button
          aria-label="Save context"
          className={cn("shrink-0", !trimmed && "opacity-40")}
          disabled={!trimmed || saving}
          onClick={() => void save()}
          size="icon-sm"
          title="Save context (Enter)"
          type="button"
        >
          {saving ? <Spinner decorative size="sm" variant="ring" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-(--negative)" role="alert">
          {error}
        </p>
      ) : demo ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Context you add in this demo stays in your browser.</p>
      ) : null}
    </div>
  );
}
