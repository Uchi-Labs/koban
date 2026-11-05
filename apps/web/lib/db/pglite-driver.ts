import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { FinanceDbDriver, FinanceDbQueryResult } from "@/lib/db/finance-db-driver";
import { acquirePgliteStoreLock, PgliteStoreLockedError, type PgliteStoreLock } from "@/lib/db/pglite-store-lock";

class PgliteFinanceDbDriver implements FinanceDbDriver {
  readonly dialect = "pglite" as const;

  constructor(
    private readonly db: PGlite,
    private readonly lock: PgliteStoreLock | null
  ) {}

  async close(): Promise<void> {
    try {
      await this.db.close();
    } finally {
      this.lock?.release();
    }
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async query<T>(sql: string, params?: readonly unknown[]): Promise<FinanceDbQueryResult<T>> {
    return this.db.query<T>(sql, params ? [...params] : undefined);
  }

  async queryCoordinationMetadata<T>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<FinanceDbQueryResult<T>> {
    return this.query<T>(sql, params);
  }
}

/**
 * Open a PGlite store under an exclusive cross-process lock and run `prepare`
 * (migrations) on it. If startup fails with a recoverable error, the store is
 * quarantined and reopened empty, still under the same lock, so a directory
 * another live process holds is never renamed. A store held by another live
 * process fails with PgliteStoreLockedError before anything is touched.
 */
export async function openLockedPgliteFinanceDb(
  dbPath: string,
  prepare: (db: FinanceDbDriver) => Promise<void>
): Promise<{ db: FinanceDbDriver; quarantinedPath: string | null }> {
  if (dbPath === ":memory:") {
    const db = new PgliteFinanceDbDriver(new PGlite(dbPath, { extensions: { vector } }), null);
    await prepareOrClose(db, prepare);
    return { db, quarantinedPath: null };
  }

  const lock = acquirePgliteStoreLock(dbPath);
  try {
    try {
      return { db: await openPreparedUnderLock(dbPath, lock, prepare), quarantinedPath: null };
    } catch (error) {
      if (!isRecoverablePgliteStartupError(error)) {
        throw error;
      }

      const quarantinedPath = quarantinePgliteDirectory(dbPath);
      return { db: await openPreparedUnderLock(dbPath, lock, prepare), quarantinedPath };
    }
  } catch (error) {
    lock.release();
    throw error;
  }
}

async function openPreparedUnderLock(
  dbPath: string,
  lock: PgliteStoreLock,
  prepare: (db: FinanceDbDriver) => Promise<void>
): Promise<FinanceDbDriver> {
  mkdirSync(dbPath, { recursive: true });
  // We hold the store lock, so any postmaster.pid left in the directory belongs
  // to a process that is gone.
  removePglitePostmasterFile(dbPath);

  const pglite = new PGlite(dbPath, { extensions: { vector } });
  // The lock is attached only once prepare succeeds; a failed attempt closes
  // its handle without releasing the lock the caller still needs.
  const attempt = new PgliteFinanceDbDriver(pglite, null);
  await prepareOrClose(attempt, prepare);
  return new PgliteFinanceDbDriver(pglite, lock);
}

async function prepareOrClose(
  db: FinanceDbDriver,
  prepare: (db: FinanceDbDriver) => Promise<void>
): Promise<void> {
  try {
    await prepare(db);
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
}

export function quarantinePgliteDirectory(dbPath: string): string {
  const originalPath = `${dbPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  if (existsSync(dbPath)) {
    renameSync(dbPath, originalPath);
  }

  mkdirSync(dbPath, { recursive: true });
  return originalPath;
}

export function isRecoverablePgliteStartupError(error: unknown): boolean {
  if (error instanceof PgliteStoreLockedError) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|postmaster|database system was interrupted|invalid checkpoint|could not read|could not open/i.test(message);
}

function removePglitePostmasterFile(dbPath: string): void {
  try {
    unlinkSync(path.join(dbPath, "postmaster.pid"));
  } catch {
    // Absent, or PGlite will surface the real startup problem.
  }
}
