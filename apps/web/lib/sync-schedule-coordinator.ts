import {
  appSyncScheduleId,
  claimAppSyncSchedule,
  claimAppSyncScheduleForRunNow,
  clearAppSyncScheduleClaim,
  ensureAppSyncSchedule,
  recordAppSyncScheduleRun,
  snapTradeSyncScheduleId,
  type AppSyncRunRecord,
  type SyncScheduleId,
  type SyncScheduleRecord
} from "@/lib/db/finance-db";
import { runAppSync, runSnapTradeSync } from "@/lib/app-sync-service";
import { withSyncScheduleClaimHeartbeat } from "@/lib/sync-schedule-claim";

export type ScheduledSyncRequest = {
  action: "run_due" | "run_now";
  claimedBy: string;
  enrichmentLimit?: number;
  includePlaid?: boolean;
  includeSimpleFin?: boolean;
  now?: number;
  sourceIds?: string[];
  target: "all_due" | "whole_app";
};

export type ScheduledSyncResult =
  | { reason: "busy" | "claimed" | "disabled" | "not_due"; status: "skipped" }
  | {
      run: AppSyncRunRecord;
      satisfiedSchedules: SyncScheduleId[];
      schedule: SyncScheduleRecord;
      status: "ran";
    };

type SyncScheduleCoordinatorState = {
  running: boolean;
};

const coordinatorGlobal = globalThis as typeof globalThis & {
  __aiFinancesSyncScheduleCoordinator?: SyncScheduleCoordinatorState;
};

function getCoordinatorState(): SyncScheduleCoordinatorState {
  return (coordinatorGlobal.__aiFinancesSyncScheduleCoordinator ??= { running: false });
}

export function isDue(schedule: SyncScheduleRecord, now = Date.now()): boolean {
  return schedule.enabled && schedule.nextRunAt !== undefined && Date.parse(schedule.nextRunAt) <= now;
}

/** Owns due checks, claim ordering, provider execution, and schedule accounting. */
export async function runScheduledSync(request: ScheduledSyncRequest): Promise<ScheduledSyncResult> {
  const state = getCoordinatorState();
  if (state.running) {
    return { reason: "busy", status: "skipped" };
  }

  state.running = true;
  try {
    const [wholeAppSchedule, snapTradeSchedule] = await Promise.all([
      ensureAppSyncSchedule(appSyncScheduleId),
      ensureAppSyncSchedule(snapTradeSyncScheduleId)
    ]);
    const now = request.now ?? Date.now();
    const wholeAppDue = isDue(wholeAppSchedule, now);
    const snapTradeDue = isDue(snapTradeSchedule, now);

    const requestedScheduleDue = wholeAppDue || (request.target === "all_due" && snapTradeDue);
    if (request.action === "run_due" && !requestedScheduleDue) {
      return {
        reason: wholeAppSchedule.enabled || (request.target === "all_due" && snapTradeSchedule.enabled)
          ? "not_due"
          : "disabled",
        status: "skipped"
      };
    }

    if (request.action === "run_now" || wholeAppDue) {
      return await runWholeAppSchedule(request, snapTradeDue);
    }

    return await runSnapTradeSchedule(request);
  } finally {
    state.running = false;
  }
}

async function runWholeAppSchedule(
  request: ScheduledSyncRequest,
  snapTradeDue: boolean
): Promise<ScheduledSyncResult> {
  const claimWholeApp = request.action === "run_now" ? claimAppSyncScheduleForRunNow : claimAppSyncSchedule;
  if (!(await claimWholeApp(appSyncScheduleId, request.claimedBy))) {
    return { reason: "claimed", status: "skipped" };
  }

  let snapTradeLeaseAcquired = false;
  try {
    return await withSyncScheduleClaimHeartbeat(appSyncScheduleId, request.claimedBy, async (wholeAppSignal) => {
      snapTradeLeaseAcquired = snapTradeDue
        ? await claimAppSyncSchedule(snapTradeSyncScheduleId, request.claimedBy)
        : await claimAppSyncScheduleForRunNow(snapTradeSyncScheduleId, request.claimedBy);

      const execute = async (signal: AbortSignal) => {
        const run = await runAppSync({
          enrichmentLimit: request.enrichmentLimit,
          includePlaid: request.includePlaid,
          includeSimpleFin: request.includeSimpleFin,
          includeSnapTrade: snapTradeLeaseAcquired,
          signal,
          sourceIds: request.sourceIds
        });
        const schedule = await recordAppSyncScheduleRun(run, appSyncScheduleId, request.claimedBy);
        const satisfiedSchedules: SyncScheduleId[] = [appSyncScheduleId];

        if (snapTradeLeaseAcquired) {
          if (snapTradeDue && didSnapTradeRunSuccessfully(run)) {
            await recordAppSyncScheduleRun(
              { ...run, errorMessage: undefined, status: "succeeded" },
              snapTradeSyncScheduleId,
              request.claimedBy
            );
            satisfiedSchedules.push(snapTradeSyncScheduleId);
          } else {
            await clearAppSyncScheduleClaim(snapTradeSyncScheduleId, request.claimedBy);
            snapTradeLeaseAcquired = false;
          }
        }

        return { run, satisfiedSchedules, schedule, status: "ran" as const };
      };

      if (!snapTradeLeaseAcquired) {
        return execute(wholeAppSignal);
      }

      return withSyncScheduleClaimHeartbeat(snapTradeSyncScheduleId, request.claimedBy, (snapTradeSignal) =>
        execute(AbortSignal.any([wholeAppSignal, snapTradeSignal]))
      );
    });
  } catch (error) {
    await clearOwnedClaims(request.claimedBy, snapTradeLeaseAcquired
      ? [appSyncScheduleId, snapTradeSyncScheduleId]
      : [appSyncScheduleId]);
    throw error;
  }
}

async function runSnapTradeSchedule(request: ScheduledSyncRequest): Promise<ScheduledSyncResult> {
  if (!(await claimAppSyncSchedule(snapTradeSyncScheduleId, request.claimedBy))) {
    return { reason: "claimed", status: "skipped" };
  }

  try {
    return await withSyncScheduleClaimHeartbeat(snapTradeSyncScheduleId, request.claimedBy, async (signal) => {
      const { run } = await runSnapTradeSync(signal);
      const schedule = await recordAppSyncScheduleRun(run, snapTradeSyncScheduleId, request.claimedBy);
      return {
        run,
        satisfiedSchedules: [snapTradeSyncScheduleId],
        schedule,
        status: "ran"
      };
    });
  } catch (error) {
    await clearOwnedClaims(request.claimedBy, [snapTradeSyncScheduleId]);
    throw error;
  }
}

export type ExclusiveSyncResult<T> =
  | { reason: "busy" | "claimed"; status: "skipped" }
  | { status: "ran"; value: T };

/**
 * Run a manual sync under the same lock the scheduler uses: the process-local
 * running flag plus a lease on each schedule in `scheduleIds`, held with a
 * heartbeat until `operation` settles. When another sync holds either, nothing
 * runs and the caller gets "skipped".
 */
export async function runExclusiveSync<T>(
  request: { claimedBy: string; scheduleIds: SyncScheduleId[] },
  operation: (signal: AbortSignal) => Promise<T>
): Promise<ExclusiveSyncResult<T>> {
  const state = getCoordinatorState();
  if (state.running) {
    return { reason: "busy", status: "skipped" };
  }

  state.running = true;
  const claimed: SyncScheduleId[] = [];
  try {
    for (const scheduleId of request.scheduleIds) {
      if (!(await claimAppSyncScheduleForRunNow(scheduleId, request.claimedBy))) {
        return { reason: "claimed", status: "skipped" };
      }
      claimed.push(scheduleId);
    }

    const withLeases = claimed.reduceRight<(signal: AbortSignal) => Promise<T>>(
      (inner, scheduleId) => (outerSignal) =>
        withSyncScheduleClaimHeartbeat(scheduleId, request.claimedBy, (leaseSignal) =>
          inner(AbortSignal.any([outerSignal, leaseSignal]))
        ),
      operation
    );

    return { status: "ran", value: await withLeases(new AbortController().signal) };
  } finally {
    await clearOwnedClaims(request.claimedBy, claimed);
    state.running = false;
  }
}

async function clearOwnedClaims(claimedBy: string, scheduleIds: SyncScheduleId[]): Promise<void> {
  const results = await Promise.allSettled(
    scheduleIds.map((scheduleId) => clearAppSyncScheduleClaim(scheduleId, claimedBy))
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[sync-schedule] failed to release claim", { scheduleId: scheduleIds[index] });
    }
  });
}

function didSnapTradeRunSuccessfully(run: AppSyncRunRecord): boolean {
  return run.snaptradeStatus === "succeeded" && run.snaptradeSummary?.skipped !== true;
}
