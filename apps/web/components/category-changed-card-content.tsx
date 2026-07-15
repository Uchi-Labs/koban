"use client";

import { XIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface CategoryChangedCardOptions {
  merchant: string;
  onApplyAll: () => void;
  onCreateRule: () => void;
}

export function CategoryChangedCardContent({
  merchant,
  onApplyAll,
  onCreateRule,
  toastId
}: CategoryChangedCardOptions & { toastId: number | string }) {
  const applyAllAction = React.useEffectEvent(onApplyAll);
  const createRuleAction = React.useEffectEvent(onCreateRule);
  const keycapClassName =
    "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 text-[11px] font-medium tabular-nums text-muted-foreground";
  const rowClassName =
    "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent";

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true;

      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        toast.dismiss(toastId);
        createRuleAction();
      } else if (event.key === "2") {
        event.preventDefault();
        toast.dismiss(toastId);
        applyAllAction();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toastId]);

  return (
    <div className="flex w-[19.5rem] flex-col rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      <div className="mb-1.5 flex items-center justify-between pl-2">
        <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Category changed</span>
        <button
          aria-label="Dismiss"
          className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground motion-reduce:transition-none sm:size-10"
          onClick={() => toast.dismiss(toastId)}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <button
        className={cn(rowClassName)}
        onClick={() => {
          toast.dismiss(toastId);
          onCreateRule();
        }}
        type="button"
      >
        <span className={keycapClassName}>1</span>
        <span className="min-w-0 flex-1 truncate">Create a rule based on the name</span>
      </button>
      <button
        className={cn(rowClassName)}
        onClick={() => {
          toast.dismiss(toastId);
          onApplyAll();
        }}
        type="button"
      >
        <span className={keycapClassName}>2</span>
        <span className="min-w-0 flex-1 truncate">Apply to all “{merchant}” transactions</span>
      </button>
    </div>
  );
}
