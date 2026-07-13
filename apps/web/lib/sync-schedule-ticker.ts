// Server-side sync scheduler. Started once per server process (instrumentation.ts):
// every minute it checks the sync_schedules rows and runs whatever is due —
// `whole_app` (all providers + enrichment, typically daily) and `snaptrade`
// (investments only, typically every 30 minutes). Before this ticker existed the
// schedule only advanced while someone had the Settings page open in a browser.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  appSyncScheduleId,
  claimAppSyncSchedule,
  clearAppSyncScheduleClaim,
  ensureAppSyncSchedule,
  recordAppSyncScheduleRun,
  snapTradeSyncScheduleId,
  type SyncScheduleRecord
} from "@/lib/db/finance-db";
import { runAppSync, runSnapTradeSync } from "@/lib/app-sync-service";
import { withSyncScheduleClaimHeartbeat } from "@/lib/sync-schedule-claim";

const TICK_INTERVAL_MS = 60_000;
const tickerClaimantId = `${hostname()}:${process.pid}:${randomUUID()}`;

let started = false;
let ticking = false;

export function startSyncScheduleTicker(): void {
  if (started || process.env.AI_FINANCES_DISABLE_SYNC_TICKER === "1") {
    return;
  }

  started = true;
  const timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  // Never keep the process alive just for the ticker.
  timer.unref?.();
  console.log("[sync-ticker] started (checks every 60s)");
}

export function isDue(schedule: SyncScheduleRecord, now = Date.now()): boolean {
  return schedule.enabled && schedule.nextRunAt !== undefined && Date.parse(schedule.nextRunAt) <= now;
}

async function tick(): Promise<void> {
  if (ticking) {
    return; // a long sync is still running — skip this beat, not queue behind it
  }

  ticking = true;
  try {
    const snaptrade = await ensureAppSyncSchedule(snapTradeSyncScheduleId);
    if (isDue(snaptrade) && await claimAppSyncSchedule(snapTradeSyncScheduleId, tickerClaimantId)) {
      console.log("[sync-ticker] snaptrade sync due — running");
      try {
        await withSyncScheduleClaimHeartbeat(snapTradeSyncScheduleId, tickerClaimantId, async (signal) => {
          const { run } = await runSnapTradeSync(signal);
          await recordAppSyncScheduleRun(run, snapTradeSyncScheduleId, tickerClaimantId);
        });
      } catch (error) {
        await clearAppSyncScheduleClaim(snapTradeSyncScheduleId, tickerClaimantId);
        throw error;
      }
    }

    const wholeApp = await ensureAppSyncSchedule(appSyncScheduleId);
    if (isDue(wholeApp) && await claimAppSyncSchedule(appSyncScheduleId, tickerClaimantId)) {
      console.log("[sync-ticker] whole-app sync due — running");
      try {
        await withSyncScheduleClaimHeartbeat(appSyncScheduleId, tickerClaimantId, async (signal) => {
          const run = await runAppSync({ enrichmentLimit: 50, includePlaid: true, includeSimpleFin: true, signal });
          await recordAppSyncScheduleRun(run, appSyncScheduleId, tickerClaimantId);
        });
      } catch (error) {
        await clearAppSyncScheduleClaim(appSyncScheduleId, tickerClaimantId);
        throw error;
      }
    }
  } catch (error) {
    console.error("[sync-ticker] tick failed:", error instanceof Error ? error.message : error);
  } finally {
    ticking = false;
  }
}
