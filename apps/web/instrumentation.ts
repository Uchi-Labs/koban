export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // Build the Effect runtime first: a bad configuration (public demo on a
    // non-demo database, hosted mode without KOBAN_SECRET_KEY, an open server
    // bound off loopback) stops the server here, before it serves a request.
    const { bootAppRuntime, disposeAppRuntime } = await import("@/lib/effect/runtime");
    try {
      await bootAppRuntime();
    } catch (error) {
      console.error(`[koban] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    registerRuntimeDispose(disposeAppRuntime);

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

// Next's own SIGTERM handler exits the process; this releases the runtime's
// resources first when it can. With NEXT_MANUAL_SIG_HANDLE set, Next installs
// no handler and this one exits after disposing.
function registerRuntimeDispose(dispose: () => Promise<void>) {
  const holder = globalThis as typeof globalThis & { __kobanRuntimeDisposeRegistered?: boolean };
  if (holder.__kobanRuntimeDisposeRegistered) return;
  holder.__kobanRuntimeDisposeRegistered = true;
  process.once("SIGTERM", () => {
    void dispose().finally(() => {
      if (process.env.NEXT_MANUAL_SIG_HANDLE) process.exit(143);
    });
  });
}
