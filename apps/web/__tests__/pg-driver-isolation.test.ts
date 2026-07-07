// @vitest-environment node

import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PgFinanceDbDriver } from "@/lib/db/pg-driver";
import { dbWriteContext } from "@/lib/db/write-context";

type QueryTarget = "pool" | "transaction";

interface DriverHarness {
  clientRelease: ReturnType<typeof vi.fn>;
  calls: QueryTarget[];
  driver: PgFinanceDbDriver;
}

describe("postgres driver transaction isolation", () => {
  it("routes queries outside a transaction to the pool", async () => {
    const { calls, driver } = createDriverHarness();

    await driver.query("SELECT 1");

    expect(calls).toEqual(["pool"]);
  });

  it("routes in-context transaction queries to the transaction client", async () => {
    const { calls, driver } = createDriverHarness();

    await dbWriteContext.run({ inWrite: true }, async () => {
      await driver.exec("BEGIN");
      await driver.query("SELECT 1");
      await driver.exec("COMMIT");
    });

    expect(calls).toEqual(["transaction", "transaction", "transaction"]);
  });

  it("routes out-of-context queries to the pool while a transaction is open", async () => {
    const { calls, driver } = createDriverHarness();

    await dbWriteContext.run({ inWrite: true }, async () => {
      await driver.exec("BEGIN");
    });
    await driver.query("SELECT 1");
    await dbWriteContext.run({ inWrite: true }, async () => {
      await driver.exec("ROLLBACK");
    });

    expect(calls).toEqual(["transaction", "pool", "transaction"]);
  });

  it("rejects BEGIN outside the serialized write queue", async () => {
    const { calls, driver } = createDriverHarness();

    await expect(driver.exec("BEGIN")).rejects.toThrow(
      "Postgres BEGIN outside the serialized write queue is not allowed."
    );

    expect(calls).toEqual([]);
  });

  it("releases the transaction client on commit and returns to the pool", async () => {
    const { calls, clientRelease, driver } = createDriverHarness();

    await dbWriteContext.run({ inWrite: true }, async () => {
      await driver.exec("BEGIN");
      await driver.exec("COMMIT");
      await driver.query("SELECT 1");
    });

    expect(clientRelease).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["transaction", "transaction", "pool"]);
  });
});

function createDriverHarness(): DriverHarness {
  const calls: QueryTarget[] = [];
  const clientRelease = vi.fn();
  const client = {
    query: vi.fn(async () => {
      calls.push("transaction");
      return { rows: [] };
    }),
    release: clientRelease
  } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    query: vi.fn(async () => {
      calls.push("pool");
      return { rows: [] };
    })
  } as unknown as Pool;

  return {
    calls,
    clientRelease,
    driver: new PgFinanceDbDriver(pool)
  };
}
