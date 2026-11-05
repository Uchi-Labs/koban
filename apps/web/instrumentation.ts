export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // First, so a bad configuration stops the server before anything else starts.
    const { bootServerRuntime } = await import("@/lib/effect/boot");
    await bootServerRuntime();

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
