import { bootAppRuntime, disposeAppRuntime } from "@/lib/effect/runtime";

/**
 * Builds the app runtime at server start. A bad configuration (public demo on
 * a non-demo database, hosted mode without KOBAN_SECRET_KEY, an open server
 * bound off loopback) exits the process with one line naming the setting,
 * before the server answers a request.
 */
export async function bootServerRuntime(): Promise<void> {
  try {
    await bootAppRuntime();
  } catch (error) {
    console.error(`[koban] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
    return;
  }
  registerRuntimeDispose();
}

// Next's own SIGTERM handler exits the process; this releases the runtime's
// resources first when it can. With NEXT_MANUAL_SIG_HANDLE set, Next installs
// no handler and this one exits after disposing.
function registerRuntimeDispose() {
  const holder = globalThis as typeof globalThis & { __kobanRuntimeDisposeRegistered?: boolean };
  if (holder.__kobanRuntimeDisposeRegistered) return;
  holder.__kobanRuntimeDisposeRegistered = true;
  process.once("SIGTERM", () => {
    void disposeAppRuntime().finally(() => {
      if (process.env.NEXT_MANUAL_SIG_HANDLE) process.exit(143);
    });
  });
}
