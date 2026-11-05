import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Config from "effect/Config";
import * as AppConfig from "@/lib/config/AppConfig";
import * as SecretBox from "@/lib/security/SecretBox";

// The one Effect runtime per server process. Route handlers, server
// components, instrumentation.ts and the sync code run effects here; services
// never call runPromise themselves (docs/architecture/effect.md).

export type AppServices = AppConfig.AppConfig | SecretBox.SecretBox;
export type AppInitError = AppConfig.AppConfigError | Config.ConfigError | SecretBox.SecretKeyFileError;

const loggerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig.AppConfig;
    return Logger.layer([config.mode === "hosted" ? Logger.consoleJson : Logger.consolePretty()]);
  })
);

export const appLayer: Layer.Layer<AppServices, AppInitError> = Layer.mergeAll(SecretBox.layer, loggerLayer).pipe(
  Layer.provideMerge(AppConfig.layer),
  Layer.provide(AppConfig.workspaceConfigProviderLayer)
);

// On globalThis, not module scope: Next can load this module more than once
// (duplicate module graphs, dev hot reload), and every copy must share one
// runtime and the resources it will own (the PGlite writer from E2 on).
const runtimeHolder = globalThis as typeof globalThis & {
  __kobanAppRuntime?: ManagedRuntime.ManagedRuntime<AppServices, AppInitError>;
};

export function appRuntime(): ManagedRuntime.ManagedRuntime<AppServices, AppInitError> {
  runtimeHolder.__kobanAppRuntime ??= ManagedRuntime.make(appLayer);
  return runtimeHolder.__kobanAppRuntime;
}

/** Runs an effect on the app runtime. `signal` interrupts it, e.g. when the HTTP client goes away. */
export function runApp<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  options?: { signal?: AbortSignal }
): Promise<Exit.Exit<A, E | AppInitError>> {
  return appRuntime().runPromiseExit(effect, options);
}

/** Promise form for callers outside Effect: resolves with the value, rejects with the failure. */
export function runServerEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return appRuntime().runPromise(effect, options);
}

/** Builds the runtime at boot so a bad configuration stops the server before it serves a request. */
export async function bootAppRuntime(): Promise<void> {
  await appRuntime().context();
}

/** Releases the runtime's resources. The next `appRuntime()` call builds a fresh one. */
export async function disposeAppRuntime(): Promise<void> {
  const runtime = runtimeHolder.__kobanAppRuntime;
  runtimeHolder.__kobanAppRuntime = undefined;
  await runtime?.dispose();
}
