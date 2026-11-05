"use client";

import { ArrowUp } from "lucide-react";
import * as React from "react";
import { DictationButton, type DictationStatus } from "@/components/dictation-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { VoiceWaveform } from "@/components/ui/voice-waveform";
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
  const [dictation, setDictation] = React.useState<DictationStatus>({ kind: "idle" });
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
      {/* Text gets the full width; dictation status and the buttons sit on their
          own row beneath it, so nothing a recording shows can squeeze the field. */}
      <div className="rounded-xl border border-border bg-card transition-colors focus-within:border-ring/60">
        <textarea
          aria-label="Add context"
          className="block max-h-32 min-h-10 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-base outline-none [field-sizing:content] md:text-sm placeholder:text-muted-foreground"
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
        <div className="flex items-center gap-1 pr-1.5 pb-1.5 pl-3">
          <DictationStatusText status={dictation} />
          <DictationButton
            disabled={saving}
            onStatusChange={setDictation}
            onText={(text) => {
              setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
              textareaRef.current?.focus();
            }}
          />
          <Button
            aria-label="Save context"
            disabled={!trimmed || saving}
            onClick={() => void save()}
            size="icon-sm"
            title="Save context (Enter)"
            type="button"
            variant={trimmed ? "default" : "ghost"}
          >
            {saving ? <Spinner decorative size="sm" variant="ring" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
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

function DictationStatusText({ status }: { status: DictationStatus }) {
  const base = "flex min-w-0 flex-1 items-center gap-2 truncate text-xs";
  if (status.kind === "recording") {
    return (
      <span aria-live="polite" className={cn(base, "text-muted-foreground")}>
        <VoiceWaveform bars={5} className="shrink-0 text-(--negative)" height={12} label="Listening" />
        <span className="truncate">
          Listening <span className="tabular-nums">{`0:${String(status.seconds).padStart(2, "0")}`}</span>
          {status.modelPercent !== null ? <> · voice model <span className="tabular-nums">{status.modelPercent}%</span></> : null}
        </span>
      </span>
    );
  }
  if (status.kind === "transcribing") {
    return (
      <span aria-live="polite" className={cn(base, "text-muted-foreground")}>
        {status.modelPercent !== null ? `Getting the voice model ready, ${status.modelPercent}%` : "Transcribing…"}
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <span className={cn(base, "text-(--negative)")} role="alert" title={status.message}>
        {status.message}
      </span>
    );
  }
  return <span aria-hidden="true" className="flex-1" />;
}
