"use client";

import { LogIn, LogOut, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderStatusBadge } from "@/components/provider-status-badge";
import { AnimatedBadge } from "@/components/ui/animated-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatefulButton } from "@/components/ui/stateful-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { playError, playSuccess } from "@/lib/ui-sound";
import { cn } from "@/lib/utils";
import type { AppSyncRunPayload, SyncSchedulePayload } from "@/lib/app-sync-runs";
import type { ProviderStatus } from "@ai-finances/schema";

interface SyncEverythingStatus {
  enrichment: {
    llm_provider: {
      configured: boolean;
      error_message?: string;
      model?: string;
      provider: string;
      status: string;
    };
  };
  ready: {
    enrichment: boolean;
    plaid: boolean;
    simplefin: boolean;
    sources: boolean;
    snaptrade: boolean;
  };
  plaid: {
    configured: boolean;
    item_count: number;
    last_synced_at?: string;
    ready_for_sync: boolean;
    standby_institution_names: string[];
    stored_account_count: number;
    stored_transaction_count: number;
  };
  simplefin: {
    configured: boolean;
    connection_count: number;
    last_errors: unknown[];
    last_synced_at?: string;
    latest_balance_as_of?: string;
    ready_for_sync: boolean;
    stored_account_count: number;
    stored_transaction_count: number;
  };
  sources: {
    blocked_count: number;
    external_source_count: number;
    installed_count: number;
    ready_count: number;
    source_item_count: number;
  };
  snaptrade: {
    configured: boolean;
    connection_count: number;
    last_synced_at?: string;
    ready_for_sync: boolean;
    registered: boolean;
    stored_account_count: number;
    stored_position_count: number;
  };
  last_run?: AppSyncRunPayload | null;
  recent_runs?: AppSyncRunPayload[];
  schedule?: SyncSchedulePayload;
}

interface SyncScheduleRunResponse {
  object: "sync_schedule_run";
  reason?: string;
  run: AppSyncRunPayload | null;
  schedule: SyncSchedulePayload;
  status: "ran" | "skipped";
}

export function SyncEverythingPanel({
  initialSchedule,
  initialStatus
}: {
  initialSchedule: SyncSchedulePayload;
  initialStatus: SyncEverythingStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [run, setRun] = useState<AppSyncRunPayload | null>(initialStatus.last_run ?? null);
  const [recentRuns, setRecentRuns] = useState<AppSyncRunPayload[]>(initialStatus.recent_runs ?? []);
  const [schedule, setSchedule] = useState(initialStatus.schedule ?? initialSchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const scheduleCheckInFlight = useRef(false);
  const [scheduleError, setScheduleError] = useState("");
  const { showToast, updateToast } = useToast();

  const refreshStatus = useCallback(async () => {
    const response = await fetch("/api/v1/sync-runs", { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as SyncEverythingStatus;
    setStatus(body);
    setRun(body.last_run ?? null);
    setRecentRuns(body.recent_runs ?? []);
    if (body.schedule) {
      setSchedule(body.schedule);
    }
  }, []);

  async function syncEverything() {
    setBusy(true);
    setError("");
    setRun(null);
    const loadingDescription = "Running Plaid, SimpleFIN, SnapTrade, evidence sources, semantic updates, and AI enrichment.";
    const toastId = showToast({
      description: (
        <span className="t-shimmer">{loadingDescription}</span>
      ),
      duration: 0,
      status: "loading",
      title: "Sync started",
    });

    try {
      const response = await fetch("/api/v1/sync-runs", {
        body: JSON.stringify({ enrichment_limit: 50 }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as AppSyncRunPayload | { error?: string };

      if (!response.ok || !("object" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Sync everything failed.");
      }

      setRun(body);
      setRecentRuns((currentRuns) => mergeRecentRuns(body, currentRuns));
      await refreshStatus();
      updateToast(toastId, {
        description: syncToastDescription(body),
        duration: 4200,
        status: body.status === "error" ? "error" : "success",
        title: `Sync ${body.status}`,
      });
      if (body.status === "error") {
        playError();
      } else {
        playSuccess();
      }
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : "Sync everything failed.";
      setError(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Sync failed",
      });
      playError();
    } finally {
      setBusy(false);
    }
  }

  async function updateSchedule(input: { enabled?: boolean; interval_minutes?: number }) {
    setScheduleBusy(true);
    setScheduleError("");

    try {
      const response = await fetch("/api/v1/sync-schedule", {
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      });
      const body = (await response.json()) as SyncSchedulePayload | { error?: string };

      if (!response.ok || !("object" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Sync schedule update failed.");
      }

      setSchedule(body);
    } catch (caughtError) {
      setScheduleError(caughtError instanceof Error ? caughtError.message : "Sync schedule update failed.");
    } finally {
      setScheduleBusy(false);
    }
  }

  const runDueSchedule = useCallback(async ({ notify = false }: { notify?: boolean } = {}) => {
    if (busy || scheduleBusy || scheduleCheckInFlight.current) {
      return;
    }

    // Background polls (notify=false) stay silent: no visible busy state, so
    // the periodic due-check never greys out buttons or flashes "Checking".
    scheduleCheckInFlight.current = true;
    if (notify) {
      setScheduleBusy(true);
      setScheduleError("");
    }
    const toastId = notify
      ? showToast({
          description: "Checking whether a scheduled sync is due.",
          duration: 0,
          status: "loading",
          title: "Checking schedule",
        })
      : "";

    try {
      const response = await fetch("/api/v1/sync-schedule", {
        body: JSON.stringify({ action: "run_due", enrichment_limit: 50 }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as SyncScheduleRunResponse | { error?: string };

      if (!response.ok || !("object" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Scheduled sync failed.");
      }

      setSchedule(body.schedule);
      if (body.run) {
        setRun(body.run);
        setRecentRuns((currentRuns) => mergeRecentRuns(body.run!, currentRuns));
        await refreshStatus();
      }
      if (notify) {
        updateToast(toastId, {
          description: body.status === "ran" && body.run ? syncToastDescription(body.run) : (body.reason ?? "No scheduled sync was due."),
          duration: 3600,
          status: body.status === "ran" ? "success" : "info",
          title: body.status === "ran" ? "Scheduled sync ran" : "No sync due",
        });
      }
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : "Scheduled sync failed.";
      setScheduleError(errorMessage);
      if (notify) {
        updateToast(toastId, {
          description: errorMessage,
          duration: 5200,
          status: "error",
          title: "Scheduled sync failed",
        });
      }
    } finally {
      scheduleCheckInFlight.current = false;
      if (notify) {
        setScheduleBusy(false);
      }
    }
  }, [busy, refreshStatus, scheduleBusy, showToast, updateToast]);

  useEffect(() => {
    if (!schedule.enabled) {
      return;
    }

    void runDueSchedule();
    const interval = window.setInterval(() => {
      void runDueSchedule();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [runDueSchedule, schedule.enabled, schedule.next_run_at]);

  return (
    <Card size="sm" className="grid gap-[18px]">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-medium">Sync everything</h1>
          <p className="text-sm text-muted-foreground">
            Runs Plaid, SimpleFIN, SnapTrade, installed evidence sources, semantic updates, and AI enrichment in one local pass.
          </p>
        </div>
        <StatefulButton
          className="shrink-0"
          disabled={busy || (!status.ready.snaptrade && !status.ready.plaid && !status.ready.simplefin)}
          data-sound="sync"
          icon={<RefreshCw className="size-4" />}
          loadingText="Syncing"
          onClick={syncEverything}
          state={busy ? "loading" : "idle"}
          type="button"
        >
          Sync everything
        </StatefulButton>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Whole app sync readiness">
          <SyncStatusTile detail={snapTradeReadinessDetail(status.snaptrade)} label="SnapTrade" ready={status.ready.snaptrade} />
          <SyncStatusTile detail={plaidReadinessDetail(status.plaid)} label="Plaid" ready={status.ready.plaid} />
          <SyncStatusTile detail={simpleFinReadinessDetail(status.simplefin)} label="SimpleFIN" ready={status.ready.simplefin} />
          <SyncStatusTile detail={sourceReadinessDetail(status.sources)} label="Evidence" ready={status.ready.sources} />
          <SyncStatusTile
            detail={llmProviderDetail(status.enrichment.llm_provider)}
            label="AI enrichment"
            ready={status.ready.enrichment}
          />
        </div>
        {status.enrichment.llm_provider.configured && status.enrichment.llm_provider.status === "error" ? (
          <p className="text-sm text-destructive">
            AI provider error: {status.enrichment.llm_provider.error_message ?? "Run provider check from the AI tab."}
          </p>
        ) : null}

        <Separator />

        <SyncScheduleControls
          busy={busy}
          runDueSchedule={runDueSchedule}
          schedule={schedule}
          scheduleBusy={scheduleBusy}
          updateSchedule={updateSchedule}
        />

        {run ? <SyncRunSummary run={run} /> : null}
        <RecentSyncRuns runs={recentRuns} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {scheduleError ? <p className="text-sm text-destructive">{scheduleError}</p> : null}
        {!status.ready.snaptrade && !status.ready.plaid && !status.ready.simplefin ? (
          <p className="text-sm text-destructive">Plaid, SimpleFIN, or SnapTrade must be configured before whole-app sync can run.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SyncScheduleControls({
  busy,
  runDueSchedule,
  schedule,
  scheduleBusy,
  updateSchedule
}: {
  busy: boolean;
  runDueSchedule: (options?: { notify?: boolean }) => Promise<void>;
  schedule: SyncSchedulePayload;
  scheduleBusy: boolean;
  updateSchedule: (input: { enabled?: boolean; interval_minutes?: number }) => Promise<void>;
}) {
  const intervalLabels: Record<number, string> = {
    60: "Every hour",
    240: "Every 4 hours",
    720: "Every 12 hours",
    1440: "Daily"
  };
  const nextRunLabel = schedule.next_run_at
    ? new Date(schedule.next_run_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : null;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-3"
      aria-label="Periodic sync"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <label className="flex items-center gap-2" htmlFor="sync-auto-enabled">
          <Switch
            checked={schedule.enabled}
            disabled={scheduleBusy}
            id="sync-auto-enabled"
            onCheckedChange={(checked) => {
              void updateSchedule({ enabled: checked });
            }}
          />
          <span className="text-sm font-medium">Auto-sync</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Interval</span>
          <Select
            disabled={scheduleBusy}
            value={String(schedule.interval_minutes)}
            onValueChange={(value) => {
              void updateSchedule({ interval_minutes: Number(value ?? schedule.interval_minutes) });
            }}
          >
            <SelectTrigger size="sm" aria-label="Sync interval" className="w-36">
              <SelectValue>
                {intervalLabels[schedule.interval_minutes] ?? `Every ${schedule.interval_minutes} min`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="60">Every hour</SelectItem>
              <SelectItem value="240">Every 4 hours</SelectItem>
              <SelectItem value="720">Every 12 hours</SelectItem>
              <SelectItem value="1440">Daily</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                schedule.enabled ? "bg-[var(--positive)]" : "bg-muted-foreground/50"
              )}
            />
            {schedule.enabled ? "Enabled" : "Paused"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!schedule.enabled || scheduleBusy || busy}
            onClick={() => {
              void runDueSchedule({ notify: true });
            }}
            type="button"
          >
            {scheduleBusy ? "Checking…" : "Check due sync"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {schedule.enabled
          ? nextRunLabel
            ? `Next run ${nextRunLabel}`
            : "Waiting for the next scheduled run"
          : "Auto-sync is off"}
        <span className="text-muted-foreground/60"> · Plaid and SimpleFIN sync manually only</span>
      </p>
    </div>
  );
}

function RecentSyncRuns({ runs }: { runs: AppSyncRunPayload[] }) {
  return (
    <div className="flex flex-col gap-2" aria-label="Recent sync runs">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Recent sync runs</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{runs.length.toLocaleString()}</span>
      </header>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No whole-app sync runs have been recorded yet.</p>
      ) : null}
      {runs.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {runs.map((run) => (
            <article
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
              data-status={run.status}
              key={run.id}
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium capitalize">{run.status}</span>
                <span className="text-xs text-muted-foreground">{new Date(run.finished_at).toLocaleString()}</span>
              </div>
              <span className="text-right text-xs text-muted-foreground">
                Plaid {run.plaid.status} · SimpleFIN {run.simplefin.status} · SnapTrade {run.snaptrade.status} · Evidence {run.sources.status} · AI {run.enrichment.status}
              </span>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SyncStatusTile({ detail, label, ready }: { detail: string; label: string; ready: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <AnimatedBadge
          contentKey={`${label}-${ready ? "ready" : "blocked"}`}
          size="sm"
          status={ready ? "success" : "danger"}
        >
          {ready ? "Ready" : "Blocked"}
        </AnimatedBadge>
      </div>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function llmProviderDetail(provider: SyncEverythingStatus["enrichment"]["llm_provider"]): string {
  if (!provider.configured) {
    return "local enrichment fallback";
  }

  const label = [provider.provider, provider.model].filter(Boolean).join(" ");

  if (provider.status === "connected") {
    return `${label} connected`;
  }

  if (provider.status === "error") {
    return `${label} error`;
  }

  if (provider.status === "stale") {
    return `${label} needs check`;
  }

  return `${label} ${provider.status}`;
}

function sourceReadinessDetail(sources: SyncEverythingStatus["sources"]): string {
  const readyCount = sources.ready_count ?? 0;
  const blockedCount = sources.blocked_count ?? Math.max((sources.external_source_count ?? 0) - readyCount, 0);
  const parts = [
    `${sources.installed_count.toLocaleString()} installed`,
    `${readyCount.toLocaleString()} ready`,
    `${blockedCount.toLocaleString()} blocked`,
    `${sources.source_item_count.toLocaleString()} records`
  ];

  return parts.join(", ");
}

function snapTradeReadinessDetail(snaptrade: SyncEverythingStatus["snaptrade"]): string {
  if (!snaptrade.configured) {
    return "credentials not configured";
  }

  if (!snaptrade.registered) {
    return "connect to create local user";
  }

  return [
    `${snaptrade.connection_count.toLocaleString()} connections`,
    `${snaptrade.stored_account_count.toLocaleString()} accounts`,
    `${snaptrade.stored_position_count.toLocaleString()} positions`
  ].join(", ");
}

function plaidReadinessDetail(plaid: SyncEverythingStatus["plaid"]): string {
  if (!plaid.configured) {
    return "credentials not configured";
  }

  const parts = [
    `${plaid.item_count.toLocaleString()} items`,
    `${plaid.stored_account_count.toLocaleString()} accounts`,
    `${plaid.stored_transaction_count.toLocaleString()} transactions`
  ];

  if (plaid.standby_institution_names.length > 0) {
    parts.push(`${plaid.standby_institution_names.join(", ")} standby`);
  }

  return parts.join(", ");
}

function simpleFinReadinessDetail(simplefin: SyncEverythingStatus["simplefin"]): string {
  if (!simplefin.configured) {
    return "access URL not configured";
  }

  const errors = Array.isArray(simplefin.last_errors) ? simplefin.last_errors.length : 0;
  const parts = [
    `${simplefin.connection_count.toLocaleString()} institutions`,
    `${simplefin.stored_account_count.toLocaleString()} accounts`,
    `${simplefin.stored_transaction_count.toLocaleString()} transactions`
  ];

  if (errors > 0) {
    parts.push(`${errors.toLocaleString()} errors`);
  }

  return parts.join(", ");
}

function SyncRunSummary({ run }: { run: AppSyncRunPayload }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border px-3 py-2.5",
        run.status === "error" ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/20"
      )}
    >
      <div className="flex items-center gap-2">
        <strong className="text-sm font-medium capitalize">Sync {run.status}</strong>
        <span className="text-xs text-muted-foreground">{new Date(run.finished_at).toLocaleString()}</span>
      </div>
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <li>
          Plaid: {run.plaid?.status ?? "error"}
          {run.plaid?.data
            ? plaidSyncDetail(run.plaid.data)
            : run.plaid?.error
              ? ` (${run.plaid.error})`
              : ""}
        </li>
        <li>
          SimpleFIN: {run.simplefin?.status ?? "error"}
          {run.simplefin?.data
            ? simpleFinSyncDetail(run.simplefin.data)
            : run.simplefin?.error
              ? ` (${run.simplefin.error})`
              : ""}
        </li>
        <li>
          SnapTrade: {run.snaptrade?.status ?? "error"}
          {run.snaptrade?.data
            ? snapTradeSyncDetail(run.snaptrade.data)
            : run.snaptrade?.error
              ? ` (${run.snaptrade.error})`
              : ""}
        </li>
        <li>
          Evidence: {run.sources?.status ?? "error"}
          {run.sources?.data ? sourceSyncDetail(run.sources.data) : run.sources?.error ? ` (${run.sources.error})` : ""}
        </li>
        <li>
          AI: {run.enrichment?.status ?? "error"}
          {run.enrichment?.data
            ? aiSyncDetail(run.enrichment.data)
            : run.enrichment?.error
              ? ` (${run.enrichment.error})`
              : ""}
        </li>
      </ul>
    </div>
  );
}

function sourceSyncDetail(data: NonNullable<AppSyncRunPayload["sources"]["data"]>): string {
  const summary = data.summary;
  const refresh = data.evidenceRefresh;
  const parts: string[] = [];

  if (summary) {
    parts.push(`${(summary.itemsWritten ?? 0).toLocaleString()} items`);
    parts.push(`${(summary.evidenceLinksSuggested ?? 0).toLocaleString()} links`);
  }

  if (refresh?.error) {
    parts.push("rematch error");
  } else if (refresh) {
    parts.push(`${(refresh.sourceItemCount ?? 0).toLocaleString()} rematched`);
    parts.push(`${(refresh.evidenceLinksSuggested ?? 0).toLocaleString()} suggested`);
  }

  const warnings =
    summary && ((summary.sourcesStale ?? 0) > 0 || (summary.sourcesErrored ?? 0) > 0)
      ? [`${(summary.sourcesStale ?? 0).toLocaleString()} stale`, `${(summary.sourcesErrored ?? 0).toLocaleString()} errors`]
      : [];

  if (warnings.length > 0) {
    parts.push(...warnings);
  }

  if (parts.length === 0 && typeof data.error === "string") {
    parts.push(data.error);
  }

  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function snapTradeSyncDetail(data: NonNullable<AppSyncRunPayload["snaptrade"]["data"]>): string {
  if (data.skipped) {
    return " (skipped)";
  }

  const parts = [
    `${(data.accountCount ?? 0).toLocaleString()} accounts`,
    `${(data.positionCount ?? 0).toLocaleString()} positions`
  ];
  const errors = Array.isArray(data.errors) ? data.errors.length : 0;

  if (errors > 0) {
    parts.push(`${errors.toLocaleString()} errors`);
  }

  return ` (${parts.join(", ")})`;
}

function simpleFinSyncDetail(data: NonNullable<AppSyncRunPayload["simplefin"]["data"]>): string {
  if (data.skipped) {
    return " (skipped)";
  }

  const parts = [
    `${(data.accountCount ?? 0).toLocaleString()} accounts`,
    `${(data.transactionCount ?? 0).toLocaleString()} transactions`
  ];
  const errors = Array.isArray(data.errors) ? data.errors.length : 0;

  if (errors > 0) {
    parts.push(`${errors.toLocaleString()} errors`);
  }

  return ` (${parts.join(", ")})`;
}

function plaidSyncDetail(data: NonNullable<AppSyncRunPayload["plaid"]["data"]>): string {
  if (data.skipped) {
    return " (skipped)";
  }

  const parts = [
    `${(data.accountCount ?? 0).toLocaleString()} accounts`,
    `${(data.transactionCount ?? 0).toLocaleString()} transactions`
  ];
  const errors = Array.isArray(data.errors) ? data.errors.length : 0;

  if ((data.removedTransactionCount ?? 0) > 0) {
    parts.push(`${(data.removedTransactionCount ?? 0).toLocaleString()} removed`);
  }

  if (errors > 0) {
    parts.push(`${errors.toLocaleString()} errors`);
  }

  return ` (${parts.join(", ")})`;
}

function aiSyncDetail(data: NonNullable<AppSyncRunPayload["enrichment"]["data"]>): string {
  const parts = [
    `${(data.suggestionsSeen ?? 0).toLocaleString()} candidates`,
    `${(data.pendingSuggestions ?? 0).toLocaleString()} pending`
  ];
  const warning = providerFallbackWarning(data.provider);

  if (warning) {
    parts.push(warning);
  }

  const semanticDetail = semanticSyncDetail(data.semanticIndex);

  if (semanticDetail) {
    parts.push(...semanticDetail);
  }

  return ` (${parts.join(", ")})`;
}

function syncToastDescription(run: AppSyncRunPayload): string {
  return `Plaid ${run.plaid.status}, SimpleFIN ${run.simplefin.status}, SnapTrade ${run.snaptrade.status}, evidence ${run.sources.status}, AI ${run.enrichment.status}.`;
}

function providerFallbackWarning(provider: Record<string, unknown> | undefined): string | undefined {
  if (!provider) {
    return undefined;
  }

  const suggestionsSeen = typeof provider.suggestionsSeen === "number" ? provider.suggestionsSeen : 0;
  const suggestionsAccepted = typeof provider.suggestionsAccepted === "number" ? provider.suggestionsAccepted : 0;
  const suggestionsRejected = typeof provider.suggestionsRejected === "number" ? provider.suggestionsRejected : 0;
  const hostedSuggestionsWereRejected = suggestionsSeen > 0 && suggestionsAccepted === 0 && suggestionsRejected > 0;

  if (provider.completed !== false && !hostedSuggestionsWereRejected) {
    return undefined;
  }

  const errorMessage = typeof provider.errorMessage === "string" ? provider.errorMessage : undefined;

  if (errorMessage) {
    return `provider fallback: ${compactSyncMessage(errorMessage)}`;
  }

  if (hostedSuggestionsWereRejected) {
    return `provider fallback: ${suggestionsRejected.toLocaleString()} hosted suggestions rejected`;
  }

  return "provider fallback";
}

function semanticSyncDetail(summary: unknown): string[] {
  if (!summary || typeof summary !== "object") {
    return [];
  }

  const index = summary as {
    documentsEmbedded?: number;
    embeddingModel?: string;
    embeddingProvider?: string;
    error?: string;
    modelChanged?: boolean;
    sourceItemEmbeddings?: number;
    staleDocuments?: number;
    transactionEmbeddings?: number;
  };

  if (index.error) {
    return ["semantic error"];
  }

  const parts = [
    `${(index.transactionEmbeddings ?? 0).toLocaleString()} transaction embeddings`,
    `${(index.sourceItemEmbeddings ?? 0).toLocaleString()} source embeddings`,
    `${(index.staleDocuments ?? 0).toLocaleString()} stale docs`
  ];

  if (index.embeddingModel) {
    parts.push(`${index.embeddingProvider === "voyage" ? "Voyage" : "local"} ${index.embeddingModel}`);
  }

  if (index.modelChanged) {
    parts.push(`${(index.documentsEmbedded ?? 0).toLocaleString()} rebuilt`);
  }

  return parts;
}

function compactSyncMessage(message: string): string {
  const compacted = message.replace(/\s+/g, " ").trim();
  return compacted.length > 160 ? `${compacted.slice(0, 157)}...` : compacted;
}

function mergeRecentRuns(run: AppSyncRunPayload, runs: AppSyncRunPayload[]): AppSyncRunPayload[] {
  const seen = new Set<string>();
  const merged: AppSyncRunPayload[] = [];

  for (const candidate of [run, ...runs]) {
    if (seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    merged.push(candidate);
  }

  return merged.slice(0, 5);
}

interface AiProviderView {
  base_url?: string;
  chatgpt_oauth_connected?: boolean;
  chatgpt_oauth_enabled?: boolean;
  configured: boolean;
  credential_source?: "none" | "openai_api_key" | "chatgpt_oauth" | "claude_subscription" | "ollama" | "local";
  embedding: {
    dimensions: number;
    model: string;
    provider: "local_hash" | "voyage";
    sends_text_to_provider: boolean;
  };
  error_message?: string;
  model?: string;
  provider: "none" | "ollama" | "openai_compatible" | string;
  status: ProviderStatus;
  timeout_ms?: number;
}

interface AiProviderCheckResponse {
  base_url?: string;
  checked_at?: string;
  chatgpt_oauth_connected?: boolean;
  chatgpt_oauth_enabled?: boolean;
  completed?: boolean;
  configured?: boolean;
  credential_source?: AiProviderView["credential_source"];
  error?: string;
  error_message?: string;
  model?: string;
  provider?: AiProviderView["provider"];
  status?: ProviderStatus;
  timeout_ms?: number;
}

interface ChatGptOAuthStartResponse {
  error?: string;
  expires_at?: string;
  user_code?: string;
  verification_url?: string;
}

interface ChatGptOAuthStatusResponse {
  active_credential_source?: AiProviderView["credential_source"];
  connected?: boolean;
  enabled?: boolean;
  error?: string;
  expires_at?: string;
}

export function AiProviderPanel({ initialProvider }: { initialProvider: AiProviderView }) {
  const [provider, setProvider] = useState(initialProvider);
  const [chatGptOAuth, setChatGptOAuth] = useState({
    connected: initialProvider.chatgpt_oauth_connected ?? false,
    enabled: initialProvider.chatgpt_oauth_enabled ?? false
  });
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthPolling, setOauthPolling] = useState(false);
  /** Device-flow user code, shown until sign-in completes or the attempt ends. */
  const [chatGptDeviceCode, setChatGptDeviceCode] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function refreshProviderStatus() {
    const response = await fetch("/api/v1/enrichment/provider", { cache: "no-store" });
    const body = (await response.json()) as AiProviderCheckResponse;

    if (!response.ok || !body.status) {
      throw new Error(body.error ?? "Unable to refresh LLM provider.");
    }

    applyProviderResponse(body);
  }

  async function checkProvider() {
    setBusy(true);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch("/api/v1/enrichment/provider", { method: "POST" });
      const body = (await response.json()) as AiProviderCheckResponse;

      if (!response.ok || !body.status) {
        throw new Error(body.error ?? "Unable to check LLM provider.");
      }

      applyProviderResponse(body);
      setIsError(body.status === "error");
      setMessage(
        body.completed
          ? `LLM provider check passed${body.checked_at ? ` at ${new Date(body.checked_at).toLocaleString()}` : ""}.`
          : body.error_message ?? "LLM provider check did not complete."
      );
    } catch (caughtError) {
      setIsError(true);
      setProvider((current) => ({
        ...current,
        error_message: caughtError instanceof Error ? caughtError.message : "Unable to check LLM provider.",
        status: "error"
      }));
      setMessage(caughtError instanceof Error ? caughtError.message : "Unable to check LLM provider.");
    } finally {
      setBusy(false);
    }
  }

  async function startChatGptSignIn() {
    setOauthBusy(true);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch("/api/auth/chatgpt/start", { method: "POST" });
      const body = (await response.json()) as ChatGptOAuthStartResponse;

      if (!response.ok || !body.user_code || !body.verification_url) {
        throw new Error(body.error ?? "Unable to start ChatGPT sign-in.");
      }

      // The device flow cannot hand the code over in the URL, so the user
      // carries it across themselves. Keep it on screen for the whole poll:
      // the tab opens on the verification page, and this message is the only
      // place the code exists.
      setChatGptDeviceCode(body.user_code);
      window.open(body.verification_url, "_blank", "noopener,noreferrer");
      setMessage(`Enter code ${body.user_code} in the ChatGPT tab to finish signing in.`);
      void pollChatGptOAuthStatus();
    } catch (caughtError) {
      setIsError(true);
      setMessage(caughtError instanceof Error ? caughtError.message : "Unable to start ChatGPT sign-in.");
    } finally {
      setOauthBusy(false);
    }
  }

  async function pollChatGptOAuthStatus() {
    setOauthPolling(true);

    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await delay(2_000);
        const status = await fetchChatGptOAuthStatus();

        if (status.connected) {
          await refreshProviderStatus();
          setIsError(false);
          setChatGptDeviceCode("");
          setMessage("ChatGPT sign-in connected.");
          return;
        }
      }

      setIsError(true);
      setChatGptDeviceCode("");
      setMessage("ChatGPT sign-in was not completed.");
    } catch (caughtError) {
      setIsError(true);
      setChatGptDeviceCode("");
      setMessage(caughtError instanceof Error ? caughtError.message : "Unable to confirm ChatGPT sign-in.");
    } finally {
      setOauthPolling(false);
    }
  }

  async function signOutChatGpt() {
    setOauthBusy(true);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch("/api/auth/chatgpt/status", { method: "DELETE" });
      const body = (await response.json()) as ChatGptOAuthStatusResponse;

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to sign out of ChatGPT.");
      }

      setChatGptOAuth({
        connected: body.connected ?? false,
        enabled: body.enabled ?? chatGptOAuth.enabled
      });
      await refreshProviderStatus();
      setMessage("ChatGPT OAuth tokens removed.");
    } catch (caughtError) {
      setIsError(true);
      setMessage(caughtError instanceof Error ? caughtError.message : "Unable to sign out of ChatGPT.");
    } finally {
      setOauthBusy(false);
    }
  }

  function applyProviderResponse(body: AiProviderCheckResponse) {
    setProvider((current) => ({
      ...current,
      base_url: body.base_url,
      chatgpt_oauth_connected: body.chatgpt_oauth_connected ?? current.chatgpt_oauth_connected,
      chatgpt_oauth_enabled: body.chatgpt_oauth_enabled ?? current.chatgpt_oauth_enabled,
      configured: body.configured ?? current.configured,
      credential_source: body.credential_source ?? current.credential_source,
      error_message: body.error_message,
      model: body.model ?? current.model,
      provider: body.provider ?? current.provider,
      status: body.status ?? current.status,
      timeout_ms: body.timeout_ms ?? current.timeout_ms
    }));
    setChatGptOAuth((current) => ({
      connected: body.chatgpt_oauth_connected ?? current.connected,
      enabled: body.chatgpt_oauth_enabled ?? current.enabled
    }));
  }

  async function fetchChatGptOAuthStatus(): Promise<ChatGptOAuthStatusResponse> {
    const response = await fetch("/api/auth/chatgpt/status", { cache: "no-store" });
    const body = (await response.json()) as ChatGptOAuthStatusResponse;

    if (!response.ok) {
      throw new Error(body.error ?? "Unable to read ChatGPT sign-in status.");
    }

    setChatGptOAuth((current) => ({
      connected: body.connected ?? current.connected,
      enabled: body.enabled ?? current.enabled
    }));

    return body;
  }

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-medium">AI enrichment provider</h1>
          <p className="text-sm text-muted-foreground">
            The LLM provider powers enrichment. Semantic search uses the embedding provider shown here.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !provider.configured}
          onClick={checkProvider}
          type="button"
        >
          {busy ? "Checking..." : "Check provider"}
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{aiProviderLabel(provider.provider)}</span>
            <span className="truncate text-xs text-muted-foreground">
              {provider.model
                ? `${provider.model}${provider.base_url ? ` at ${provider.base_url}` : ""}`
                : provider.error_message ?? "No model configured"}
            </span>
          </div>
          <ProviderStatusBadge status={busy ? "syncing" : provider.status} />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ProviderMetaTile label="Provider" value={aiProviderLabel(provider.provider)} />
          <ProviderMetaTile label="Credential" value={credentialSourceLabel(provider.credential_source)} />
          <ProviderMetaTile label="Model" value={provider.model ?? "—"} />
          <ProviderMetaTile
            label="Timeout"
            value={provider.timeout_ms ? `${(provider.timeout_ms / 1000).toLocaleString()}s` : "—"}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Embedding provider</span>
            <span className="truncate text-xs text-muted-foreground">
              {embeddingProviderLabel(provider.embedding.provider)} · {provider.embedding.model} ·{" "}
              {provider.embedding.dimensions.toLocaleString()} dims
            </span>
          </div>
          <ProviderStatusBadge status="connected" />
        </div>

        {chatGptOAuth.enabled ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">ChatGPT OAuth</span>
                <span className="text-xs text-muted-foreground">
                  {chatGptOAuth.connected ? "Signed in" : "Not signed in"}
                </span>
              </div>
              {chatGptOAuth.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={oauthBusy || oauthPolling}
                  onClick={signOutChatGpt}
                  type="button"
                >
                  <LogOut className="size-4" />
                  Sign out
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={oauthBusy || oauthPolling}
                  onClick={startChatGptSignIn}
                  type="button"
                >
                  <LogIn className="size-4" />
                  {oauthPolling ? "Waiting..." : "Sign in"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Experimental: this uses OpenAI&apos;s Codex OAuth client for ChatGPT subscription access. It may
              violate OpenAI ToS for non-Codex use and can break at any time.
            </p>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          {provider.embedding.sends_text_to_provider
            ? "Voyage embeddings send transaction and source text to Voyage AI."
            : "Local hash embeddings keep transaction and source text on this device."}
        </p>

        {chatGptDeviceCode ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Enter this code at ChatGPT to finish signing in</span>
            <code className="w-fit rounded-md border bg-muted px-3 py-1.5 font-mono text-lg tracking-[0.2em] tabular-nums">
              {chatGptDeviceCode}
            </code>
          </div>
        ) : null}

        {message ? (
          <p className={cn("text-sm", isError ? "text-destructive" : "text-muted-foreground")}>{message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProviderMetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}

function aiProviderLabel(provider: AiProviderView["provider"]): string {
  if (provider === "ollama") {
    return "Ollama";
  }

  if (provider === "openai_compatible") {
    return "OpenAI-compatible";
  }

  if (provider === "claude_subscription") {
    return "Claude subscription";
  }

  return "Local enrichment fallback";
}

function credentialSourceLabel(source: AiProviderView["credential_source"]): string {
  if (source === "openai_api_key") {
    return "API key";
  }

  if (source === "chatgpt_oauth") {
    return "ChatGPT OAuth";
  }

  if (source === "claude_subscription") {
    return "Claude Code CLI";
  }

  if (source === "ollama") {
    return "Ollama";
  }

  if (source === "local") {
    return "Local";
  }

  return "None";
}

function embeddingProviderLabel(provider: AiProviderView["embedding"]["provider"]): string {
  return provider === "voyage" ? "Voyage" : "Local hash";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
