// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeFinanceDbForTests, createCategory, listCategories } from "@/lib/db/finance-db";
import { openLockedPgliteFinanceDb } from "@/lib/db/pglite-driver";
import { PgliteStoreLockedError, pgliteStoreLockPath } from "@/lib/db/pglite-store-lock";

let root: string | null = null;
let holder: ChildProcess | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  holder?.kill("SIGKILL");
  holder = null;
  if (root) {
    rmSync(root, { force: true, recursive: true });
    root = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
});

function useTempStore(): string {
  root = mkdtempSync(path.join(tmpdir(), "koban-store-lock-"));
  const storePath = path.join(root, "pglite");
  process.env.AI_FINANCES_PGLITE_DIR = storePath;
  return storePath;
}

async function spawnLiveHolder(storePath: string): Promise<number> {
  holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const pid = holder.pid!;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const startTime = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  writeFileSync(pgliteStoreLockPath(storePath), JSON.stringify({ pid, startTime, token: "other-process" }));
  return pid;
}

describe("PGlite store lock", () => {
  it("refuses a second open of a live store and leaves the first store's data intact", async () => {
    const storePath = useTempStore();
    await createCategory({ name: "Lock check" });

    await expect(openLockedPgliteFinanceDb(storePath, async () => undefined)).rejects.toBeInstanceOf(
      PgliteStoreLockedError
    );
    await expect(openLockedPgliteFinanceDb(storePath, async () => undefined)).rejects.toThrow(
      /already open in another process/
    );

    const categories = await listCategories();
    expect(categories.map((category) => category.name)).toContain("Lock check");
  });

  it.runIf(process.platform === "linux")(
    "refuses to open, and never quarantines, a store another live process holds",
    async () => {
      const storePath = useTempStore();
      mkdirSync(storePath, { recursive: true });
      // PGlite writes -42 as its pid; the old guard treated that as "no live writer".
      writeFileSync(path.join(storePath, "postmaster.pid"), "-42\n");
      writeFileSync(path.join(storePath, "PG_VERSION"), "not a real store");
      const holderPid = await spawnLiveHolder(storePath);

      await expect(listCategories()).rejects.toThrow(`pid ${holderPid}`);

      expect(readFileSync(path.join(storePath, "postmaster.pid"), "utf8")).toBe("-42\n");
      expect(readdirSync(root!).filter((name) => name.includes(".corrupt-"))).toEqual([]);
      expect(JSON.parse(readFileSync(pgliteStoreLockPath(storePath), "utf8"))).toMatchObject({ pid: holderPid });
    }
  );

  it("takes over a lock left by a process that has exited", async () => {
    const storePath = useTempStore();
    holder = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const deadPid = holder.pid!;
    await new Promise((resolve) => holder!.once("exit", resolve));
    writeFileSync(pgliteStoreLockPath(storePath), JSON.stringify({ pid: deadPid, startTime: "1", token: "gone" }));

    await createCategory({ name: "After stale lock" });

    expect((await listCategories()).map((category) => category.name)).toContain("After stale lock");
    expect(JSON.parse(readFileSync(pgliteStoreLockPath(storePath), "utf8"))).toMatchObject({ pid: process.pid });
  });

  it("releases the lock on close so the store can be reopened", async () => {
    const storePath = useTempStore();
    await createCategory({ name: "Reopen" });
    await closeFinanceDbForTests();

    expect(existsSync(pgliteStoreLockPath(storePath))).toBe(false);
    expect((await listCategories()).map((category) => category.name)).toContain("Reopen");
  });
});
