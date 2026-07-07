import { Layer, ManagedRuntime } from "effect";
import type { Effect } from "effect";

const serverRuntime = ManagedRuntime.make(Layer.empty);

export function runServerEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return serverRuntime.runPromise(effect);
}
