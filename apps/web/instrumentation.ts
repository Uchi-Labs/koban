export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { isPublicDemo } = await import("@/lib/public-demo");
    if (isPublicDemo()) {
      const { startPublicDemoReseed } = await import("@/lib/public-demo-reseed");
      startPublicDemoReseed();
      return;
    }
    const { startSyncScheduleTicker } = await import("@/lib/sync-schedule-ticker");
    startSyncScheduleTicker();
  }
}
