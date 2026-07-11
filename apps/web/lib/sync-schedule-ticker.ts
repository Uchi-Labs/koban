// Server-side sync scheduler. Started once per server process (instrumentation.ts):
// every minute it checks the sync_schedules rows and runs whatever is due —
// `whole_app` (all providers + enrichment, typically daily) and `snaptrade`
// (investments only, typically every 30 minutes). Before this ticker existed the
// schedule only advanced while someone had the Settings page open in a browser.

import {
  appSyncScheduleId,
  ensureAppSyncSchedule,
  recordAppSyncScheduleRun,
  snapTradeSyncScheduleId,
  type SyncScheduleRecord
} from "@/lib/db/finance-db";
import { runAppSync, runSnapTradeSync } from "@/lib/app-sync-service";

const TICK_INTERVAL_MS = 60_000;

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

function isDue(schedule: SyncScheduleRecord): boolean {
  return schedule.enabled && schedule.nextRunAt !== undefined && Date.parse(schedule.nextRunAt) <= Date.now();
}

async function tick(): Promise<void> {
  if (ticking) {
    return; // a long sync is still running — skip this beat, not queue behind it
  }

  ticking = true;
  try {
    const snaptrade = await ensureAppSyncSchedule(snapTradeSyncScheduleId);
    if (isDue(snaptrade)) {
      console.log("[sync-ticker] snaptrade sync due — running");
      const { run } = await runSnapTradeSync();
      await recordAppSyncScheduleRun(run, snapTradeSyncScheduleId);
    }

    const wholeApp = await ensureAppSyncSchedule(appSyncScheduleId);
    if (isDue(wholeApp)) {
      console.log("[sync-ticker] whole-app sync due — running");
      const run = await runAppSync({ enrichmentLimit: 50, includePlaid: true, includeSimpleFin: true });
      await recordAppSyncScheduleRun(run, appSyncScheduleId);
    }
  } catch (error) {
    console.error("[sync-ticker] tick failed:", error instanceof Error ? error.message : error);
  } finally {
    ticking = false;
  }
}
