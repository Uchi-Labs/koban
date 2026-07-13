// @vitest-environment node

import { Effect, Schedule } from "effect";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isInDbWriteScope, runInDbWriteScope } from "@/lib/db/db-write-context";
import { enqueueDbWriteForTests } from "@/lib/db/finance-db";
import { PgFinanceDbDriver } from "@/lib/db/pg-driver";

function createDriverHarness() {
  const clientQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
  const clientRelease = vi.fn();
  const client = { query: clientQuery, release: clientRelease };
  const poolQuery = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
  const pool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    query: poolQuery
  };

  return {
    clientQuery,
    clientRelease,
    driver: new PgFinanceDbDriver(pool as unknown as Pool),
    poolQuery
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Postgres DB write scope routing", () => {
  it("routes an out-of-scope query through the pool", async () => {
    const { clientQuery, driver, poolQuery } = createDriverHarness();

    await driver.query("SELECT outside_scope");

    expect(poolQuery).toHaveBeenCalledWith("SELECT outside_scope", undefined);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("routes in-scope transaction queries through the transaction client", async () => {
    const { clientQuery, driver, poolQuery } = createDriverHarness();

    await runInDbWriteScope(async () => {
      await driver.exec("BEGIN");
      await driver.query("SELECT in_scope");
      await driver.exec("COMMIT");
    });

    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "SELECT in_scope", "COMMIT"]);
    expect(poolQuery).not.toHaveBeenCalledWith("SELECT in_scope", undefined);
  });

  it("keeps an out-of-scope query on the pool while an in-scope transaction is open", async () => {
    const { clientQuery, driver, poolQuery } = createDriverHarness();

    await runInDbWriteScope(() => driver.exec("BEGIN"));
    await driver.query("SELECT concurrent_read");
    await driver.exec("COMMIT");

    expect(poolQuery).toHaveBeenCalledWith("SELECT concurrent_read", undefined);
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("warns and uses legacy client routing when BEGIN starts outside the write scope", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { clientQuery, driver, poolQuery } = createDriverHarness();

    await driver.exec("BEGIN");
    await driver.query("SELECT legacy_transaction");
    await driver.exec("ROLLBACK");

    expect(warning).toHaveBeenCalledWith(
      "[pg-driver] BEGIN outside the DB write queue; falling back to legacy shared-client routing."
    );
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "SELECT legacy_transaction", "ROLLBACK"]);
    expect(poolQuery).not.toHaveBeenCalledWith("SELECT legacy_transaction", undefined);
  });

  it("returns in-scope queries to the pool after COMMIT", async () => {
    const { clientQuery, driver, poolQuery } = createDriverHarness();

    await runInDbWriteScope(async () => {
      await driver.exec("BEGIN");
      await driver.exec("COMMIT");
      await driver.query("SELECT after_commit");
    });

    expect(clientQuery.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
    expect(poolQuery).toHaveBeenCalledWith("SELECT after_commit", undefined);
  });
});

describe("Effect DB write scope propagation", () => {
  it("preserves the write scope across timeout and retry scheduling", async () => {
    let attempts = 0;
    const pipeline = Effect.tryPromise({
      try: () => enqueueDbWriteForTests(async () => {
        expect(isInDbWriteScope()).toBe(true);
        await Promise.resolve();
        expect(isInDbWriteScope()).toBe(true);
        attempts += 1;
        if (attempts === 1) {
          throw new Error("retry once");
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(isInDbWriteScope()).toBe(true);
        return "completed";
      }),
      catch: (error) => error instanceof Error ? error : new Error("write failed")
    }).pipe(
      Effect.timeoutFail({
        duration: "1 second",
        onTimeout: () => new Error("write timed out")
      }),
      Effect.retry(Schedule.recurs(1))
    );

    await expect(Effect.runPromise(pipeline)).resolves.toBe("completed");
    expect(attempts).toBe(2);
    expect(isInDbWriteScope()).toBe(false);
  });
});
