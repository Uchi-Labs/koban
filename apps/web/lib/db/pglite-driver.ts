import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { FinanceDbDriver, FinanceDbQueryResult } from "@/lib/db/finance-db-driver";

class PgliteFinanceDbDriver implements FinanceDbDriver {
  readonly dialect = "pglite" as const;

  constructor(private readonly db: PGlite) {}

  async close(): Promise<void> {
    await this.db.close();
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async query<T>(sql: string, params?: readonly unknown[]): Promise<FinanceDbQueryResult<T>> {
    return this.db.query<T>(sql, params ? [...params] : undefined);
  }
}

export async function openPgliteFinanceDb(dbPath: string): Promise<FinanceDbDriver> {
  if (dbPath !== ":memory:") {
    mkdirSync(dbPath, { recursive: true });
    removeStalePglitePostmasterFile(dbPath);
  }

  return new PgliteFinanceDbDriver(new PGlite(dbPath, { extensions: { vector } }));
}

export function quarantinePgliteDirectory(dbPath: string): string {
  const originalPath = `${dbPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  if (existsSync(dbPath)) {
    renameSync(dbPath, originalPath);
  }

  mkdirSync(dbPath, { recursive: true });
  return originalPath;
}

export function hasActivePglitePostmaster(dbPath: string): boolean {
  const postmasterPath = path.join(dbPath, "postmaster.pid");

  if (!existsSync(postmasterPath)) {
    return false;
  }

  try {
    const rawPid = readFileSync(postmasterPath, "utf8").split(/\r?\n/, 1)[0];
    const pid = Number.parseInt(rawPid ?? "", 10);
    return Number.isFinite(pid) && pid > 0 && processIsRunning(pid);
  } catch {
    return false;
  }
}

export function isRecoverablePgliteStartupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|postmaster|database system was interrupted|invalid checkpoint|could not read|could not open/i.test(message);
}

function removeStalePglitePostmasterFile(dbPath: string): void {
  const postmasterPath = path.join(dbPath, "postmaster.pid");

  if (!existsSync(postmasterPath)) {
    return;
  }

  try {
    const rawPid = readFileSync(postmasterPath, "utf8").split(/\r?\n/, 1)[0];
    const pid = Number.parseInt(rawPid ?? "", 10);

    if (Number.isFinite(pid) && pid > 0 && processIsRunning(pid)) {
      return;
    }

    unlinkSync(postmasterPath);
  } catch {
    // Let PGlite surface the original startup problem if the stale pid file cannot be inspected or removed.
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
