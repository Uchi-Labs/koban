// Server-side sync scheduler. Started once per server process (instrumentation.ts):
// every minute it checks the sync_schedules rows and runs whatever is due —
// `whole_app` (all providers + enrichment, typically daily) and `snaptrade`
// (investments only, typically every 30 minutes). Before this ticker existed the
// schedule only advanced while someone had the Settings page open in a browser.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { runScheduledSync } from "@/lib/sync-schedule-coordinator";

export { isDue } from "@/lib/sync-schedule-coordinator";

const TICK_INTERVAL_MS = 60_000;
const tickerClaimantId = `${hostname()}:${process.pid}:${randomUUID()}`;

const tickerGlobal = globalThis as typeof globalThis & {
  __aiFinancesSyncScheduleTickerStarted?: boolean;
};

export function startSyncScheduleTicker(): void {
  if (tickerGlobal.__aiFinancesSyncScheduleTickerStarted || process.env.AI_FINANCES_DISABLE_SYNC_TICKER === "1") {
    return;
  }

  tickerGlobal.__aiFinancesSyncScheduleTickerStarted = true;
  const timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  // Never keep the process alive just for the ticker.
  timer.unref?.();
  console.log("[sync-ticker] started (checks every 60s)");
}

async function tick(): Promise<void> {
  try {
    await runScheduledSync({
      action: "run_due",
      claimedBy: tickerClaimantId,
      enrichmentLimit: 50,
      includePlaid: true,
      includeSimpleFin: true,
      target: "all_due"
    });
  } catch (error) {
    console.error("[sync-ticker] tick failed:", error instanceof Error ? error.message : error);
  }
}
