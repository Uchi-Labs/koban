export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startSyncScheduleTicker } = await import("@/lib/sync-schedule-ticker");
    startSyncScheduleTicker();
  }
}
