"use client";

import { Check, CircleAlert } from "lucide-react";
import * as React from "react";
import { DynamicIsland, DynamicIslandView } from "@/components/ui/dynamic-island";
import { Loader } from "@/components/ui/loader";
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import type { SyncIslandState } from "@/lib/sync-island-state";
import { cn } from "@/lib/utils";

const SYNC_STATUS_DOT_TONE: Record<SyncIslandState["tone"], StatusDotTone> = {
  error: "error",
  idle: "neutral",
  success: "success",
  syncing: "active"
};

export function SyncStatusIsland({ state }: { state: SyncIslandState }) {
  const compact = React.useMemo(
    () => (
      <>
        <StatusDot inline size="sm" tone={SYNC_STATUS_DOT_TONE[state.tone]} />
        <span className="truncate">{state.compactLabel}</span>
      </>
    ),
    [state.compactLabel, state.tone]
  );

  return (
    <DynamicIsland
      className={cn(
        "max-w-full",
        state.tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        state.tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
        state.tone === "syncing" && "border-primary/25 bg-primary/10 text-primary"
      )}
      compact={compact}
      view={state.view}
    >
      <DynamicIslandView className="min-w-[200px]" id="syncing">
        <div className="flex w-full items-center gap-2.5">
          <Loader className="shrink-0" label="Syncing" size={16} variant="dots" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">Syncing {state.phaseLabel}</p>
            <p className="truncate text-[11px] text-current/70">{state.detail}</p>
          </div>
        </div>
      </DynamicIslandView>
      <DynamicIslandView className="min-w-[170px]" id="success">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Check className="size-4" />
          <span>{state.compactLabel}</span>
        </div>
      </DynamicIslandView>
      <DynamicIslandView className="min-w-[170px]" id="error">
        <div className="flex items-center gap-2 text-xs font-medium">
          <CircleAlert className="size-4" />
          <span>{state.compactLabel}</span>
        </div>
      </DynamicIslandView>
    </DynamicIsland>
  );
}
