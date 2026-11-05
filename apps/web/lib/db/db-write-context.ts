import { AsyncLocalStorage } from "node:async_hooks";

// Marks async flows that run inside the serialized DB write queue. The pg
// driver uses this to decide whether a query belongs to the queue's open
// transaction or is an unrelated concurrent read that must use the pool —
// otherwise page reads pipeline onto the transaction client (pg deprecation
// warning) and serialize behind sync writes.
//
// The store MUST be a process-wide singleton. Next evaluates a module once per
// module graph (route handlers, server components and the instrumentation hook
// can each get their own copy). Two copies means `runInDbWriteScope` writes to
// one AsyncLocalStorage while `isInDbWriteScope` reads a different, always-empty
// one — so every legitimately-queued write reports itself as being OUTSIDE the
// queue. In pg-driver that flips `transactionOutsideWriteScope`, which routes
// every query in the process onto a single transaction client and wedges all
// writes until the server restarts.
//
// Same failure mode and same fix as the duplicated PGlite handle in
// finance-db.ts — see `getFinanceDbState`.
const dbWriteContextGlobal = globalThis as typeof globalThis & {
  __aiFinancesDbWriteScope?: AsyncLocalStorage<DbWriteScope>;
};

/**
 * Per-operation state for one queued write. The pg driver marks it when the
 * operation's transaction is rolled back by the watchdog, so the rest of that
 * operation fails instead of running as autocommit statements.
 */
export interface DbWriteScope {
  abortedTransaction?: Error;
}

function getDbWriteScope(): AsyncLocalStorage<DbWriteScope> {
  return (dbWriteContextGlobal.__aiFinancesDbWriteScope ??= new AsyncLocalStorage<DbWriteScope>());
}

export function runInDbWriteScope<T>(operation: () => Promise<T>): Promise<T> {
  return getDbWriteScope().run({}, operation);
}

export function isInDbWriteScope(): boolean {
  return getDbWriteScope().getStore() !== undefined;
}

export function currentDbWriteScope(): DbWriteScope | undefined {
  const store = getDbWriteScope().getStore();
  // A store left by an older module version during dev reload may not be an object.
  return typeof store === "object" ? store : undefined;
}
