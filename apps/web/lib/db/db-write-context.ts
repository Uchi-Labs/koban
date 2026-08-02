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
  __aiFinancesDbWriteScope?: AsyncLocalStorage<true>;
};

function getDbWriteScope(): AsyncLocalStorage<true> {
  return (dbWriteContextGlobal.__aiFinancesDbWriteScope ??= new AsyncLocalStorage<true>());
}

export function runInDbWriteScope<T>(operation: () => Promise<T>): Promise<T> {
  return getDbWriteScope().run(true, operation);
}

export function isInDbWriteScope(): boolean {
  return getDbWriteScope().getStore() === true;
}
