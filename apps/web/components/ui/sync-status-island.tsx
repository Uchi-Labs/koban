"use client";

import { Check, CircleAlert, Cloud, RefreshCw } from "lucide-react";
import * as React from "react";
import { DynamicIsland, DynamicIslandView } from "@/components/ui/dynamic-island";
import { Loader } from "@/components/ui/loader";
import type { SyncIslandState } from "@/lib/sync-island-state";
import { cn } from "@/lib/utils";

export function SyncStatusIsland({ state }: { state: SyncIslandState }) {
  const compact = React.useMemo(
    () => (
      <>
        <SyncIslandIcon tone={state.tone} />
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

function SyncIslandIcon({ tone }: { tone: SyncIslandState["tone"] }) {
  if (tone === "syncing") {
    return <RefreshCw className="size-3.5 animate-spin" />;
  }

  if (tone === "success") {
    return <Check className="size-3.5" />;
  }

  if (tone === "error") {
    return <CircleAlert className="size-3.5" />;
  }

  return <Cloud className="size-3.5" />;
}
