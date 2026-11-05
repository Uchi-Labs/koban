import { randomUUID } from "node:crypto";
import { closeSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";

// PGlite's own postmaster.pid holds -42, not a pid, so it cannot tell a live
// writer from a crashed one. This lock file sits beside the store directory
// (not inside it, so quarantining the directory never moves it) and records the
// real OS pid plus that process's start time, which catches pid reuse.

export interface PgliteStoreLockOwner {
  hostname?: string;
  pid: number;
  startTime: string | null;
  token: string;
}

export interface PgliteStoreLock {
  readonly lockPath: string;
  readonly owner: PgliteStoreLockOwner;
  release(): void;
}

export class PgliteStoreLockedError extends Error {
  readonly code = "PGLITE_STORE_LOCKED";

  constructor(
    readonly storePath: string,
    readonly lockPath: string,
    readonly holderPid: number
  ) {
    super(
      `The local database at ${storePath} is already open in another process (pid ${holderPid}). ` +
        "PGlite allows one process at a time: stop the other Koban server, test run, or script, then retry. " +
        `If no such process exists, delete ${lockPath}.`
    );
    this.name = "PgliteStoreLockedError";
  }
}

// Locks held by this process, keyed by lock path. A second open of the same
// store from this process is refused like any other second writer.
const heldLocksGlobal = globalThis as typeof globalThis & {
  __aiFinancesPgliteStoreLocks?: Map<string, PgliteStoreLock>;
};

function heldLocks(): Map<string, PgliteStoreLock> {
  return (heldLocksGlobal.__aiFinancesPgliteStoreLocks ??= new Map());
}

export function pgliteStoreLockPath(storePath: string): string {
  return `${storePath.replace(/[\\/]+$/, "")}.lock`;
}

export function acquirePgliteStoreLock(storePath: string): PgliteStoreLock {
  const lockPath = pgliteStoreLockPath(storePath);
  const owner: PgliteStoreLockOwner = {
    pid: process.pid,
    startTime: readProcessStartTime(process.pid),
    token: randomUUID()
  };

  if (heldLocks().has(lockPath)) {
    throw new PgliteStoreLockedError(storePath, lockPath, process.pid);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (tryCreateLockFile(lockPath, owner)) {
      const lock: PgliteStoreLock = {
        lockPath,
        owner,
        release: () => releaseLock(lockPath, owner)
      };
      heldLocks().set(lockPath, lock);
      return lock;
    }

    const existingText = readLockText(lockPath);
    if (existingText === null) {
      continue;
    }

    const existing = parseLockOwner(existingText);
    if (existing && isLockOwnerAlive(existing)) {
      throw new PgliteStoreLockedError(storePath, lockPath, existing.pid);
    }

    removeStaleLock(lockPath, existingText);
  }

  const holder = parseLockOwner(readLockText(lockPath) ?? "");
  throw new PgliteStoreLockedError(storePath, lockPath, holder?.pid ?? -1);
}

export function isPgliteStoreLockHeldByThisProcess(storePath: string): boolean {
  return heldLocks().has(pgliteStoreLockPath(storePath));
}

function tryCreateLockFile(lockPath: string, owner: PgliteStoreLockOwner): boolean {
  let fd: number;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }

  try {
    writeSync(fd, JSON.stringify(owner));
  } finally {
    closeSync(fd);
  }
  return true;
}

function readLockText(lockPath: string): string | null {
  try {
    return readFileSync(lockPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseLockOwner(text: string): PgliteStoreLockOwner | null {
  try {
    const parsed = JSON.parse(text) as Partial<PgliteStoreLockOwner>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    return {
      pid: parsed.pid,
      startTime: typeof parsed.startTime === "string" ? parsed.startTime : null,
      token: typeof parsed.token === "string" ? parsed.token : ""
    };
  } catch {
    return null;
  }
}

function isLockOwnerAlive(owner: PgliteStoreLockOwner): boolean {
  if (owner.pid === process.pid) {
    // Our own pid but not in this process's held set: left behind by an
    // earlier process that happened to get the same pid.
    return false;
  }

  if (!processIsRunning(owner.pid)) {
    return false;
  }

  const currentStartTime = readProcessStartTime(owner.pid);
  if (owner.startTime && currentStartTime && owner.startTime !== currentStartTime) {
    return false;
  }

  return true;
}

// Move the stale file aside atomically, then confirm we moved the file we
// judged stale. If another process replaced it in between, put theirs back.
function removeStaleLock(lockPath: string, staleText: string): void {
  const asidePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    renameSync(lockPath, asidePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  const movedText = readLockText(asidePath);
  if (movedText !== staleText && movedText !== null) {
    try {
      linkSync(asidePath, lockPath);
    } catch {
      // A third process already holds the path; its lock stands.
    }
  }

  try {
    unlinkSync(asidePath);
  } catch {
    // Leftover aside files are inert.
  }
}

function releaseLock(lockPath: string, owner: PgliteStoreLockOwner): void {
  const held = heldLocks().get(lockPath);
  if (held?.owner.token !== owner.token) {
    return;
  }
  heldLocks().delete(lockPath);

  const current = parseLockOwner(readLockText(lockPath) ?? "");
  if (current?.token === owner.token) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone.
    }
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

// Linux only: field 22 of /proc/<pid>/stat is the start time in clock ticks
// since boot. Elsewhere this returns null and liveness rests on the pid alone.
function readProcessStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const afterCommand = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return afterCommand[19] ?? null;
  } catch {
    return null;
  }
}

const exitHookGlobal = globalThis as typeof globalThis & { __aiFinancesPgliteStoreLockExitHook?: boolean };

if (!exitHookGlobal.__aiFinancesPgliteStoreLockExitHook) {
  exitHookGlobal.__aiFinancesPgliteStoreLockExitHook = true;
  process.once("exit", () => {
    for (const lock of [...heldLocks().values()]) {
      lock.release();
    }
  });
}
