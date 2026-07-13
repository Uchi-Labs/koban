import { Layer, ManagedRuntime } from "effect";
import type { Effect } from "effect";

const serverRuntime = ManagedRuntime.make(Layer.empty);

export function runServerEffect<A, E>(
  effect: Effect.Effect<A, E, never>,
  options?: { signal?: AbortSignal }
): Promise<A> {
  return serverRuntime.runPromise(effect, options);
}
