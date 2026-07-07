import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient marker for "currently executing inside the serialized DB write
 * queue". The Postgres driver uses it to decide whether a statement belongs
 * to the open write transaction or must go to the pool. See plan 025.
 */
export const dbWriteContext = new AsyncLocalStorage<{ inWrite: true }>();

export function isInDbWriteContext(): boolean {
  return dbWriteContext.getStore()?.inWrite === true;
}
