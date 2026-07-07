// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeFinanceDbForTests,
  readFinanceDbSnapshot,
  replaceSimpleFinLedgerSnapshot,
  updateDbTransaction
} from "@/lib/db/finance-db";
import {
  accountIdForSimpleFin,
  computeSimpleFinSyncWindow,
  inferSimpleFinAccountType,
  mapSimpleFinAccountSetToDomain,
  parseSimpleFinMoney,
  providerConnectionIdForSimpleFin,
  syncSimpleFinData,
  transactionIdForSimpleFin,
  type SimpleFinAccountSet
} from "@/lib/simplefin-server";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  vi.unstubAllGlobals();
  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.SIMPLEFIN_ACCESS_URL;
});

describe("SimpleFIN mapping", () => {
  it("maps account balances, org fallback, account types, and transactions", () => {
    const mapped = mapSimpleFinAccountSetToDomain({
      accountSet: createSimpleFinFixture(),
      syncedAt: "2026-07-06T12:00:00.000Z"
    });
    const sofiKey = "https://sofi.example/simplefin";
    const discoverKey = "discover.com";

    expect(mapped.errors).toEqual([]);
    expect(mapped.providerConnections).toEqual([
      expect.objectContaining({
        displayName: "SimpleFIN - SoFi",
        id: providerConnectionIdForSimpleFin(sofiKey),
        provider: "simplefin",
        status: "connected"
      }),
      expect.objectContaining({
        displayName: "SimpleFIN - discover.com",
        id: providerConnectionIdForSimpleFin(discoverKey),
        provider: "simplefin",
        status: "connected"
      })
    ]);
    expect(mapped.accounts).toEqual([
      expect.objectContaining({
        currentBalance: 1200.1,
        id: accountIdForSimpleFin(sofiKey, "sofi-savings"),
        institutionName: "SoFi",
        lastUpdatedAt: "2026-07-06T10:00:00.000Z",
        type: "savings"
      }),
      expect.objectContaining({
        currentBalance: -431.22,
        id: accountIdForSimpleFin(discoverKey, "discover-card"),
        institutionName: "discover.com",
        lastUpdatedAt: "2026-07-06T10:05:00.000Z",
        type: "credit_card"
      })
    ]);
    expect(mapped.balanceSnapshots).toEqual([
      expect.objectContaining({
        accountId: accountIdForSimpleFin(sofiKey, "sofi-savings"),
        asOfDate: "2026-07-06",
        capturedAt: "2026-07-06T10:00:00.000Z",
        source: "simplefin"
      }),
      expect.objectContaining({
        accountId: accountIdForSimpleFin(discoverKey, "discover-card"),
        capturedAt: "2026-07-06T10:05:00.000Z",
        source: "simplefin"
      })
    ]);
    expect(mapped.transactions).toEqual([
      expect.objectContaining({
        amount: 5.25,
        categoryId: "cat_income",
        id: transactionIdForSimpleFin(accountIdForSimpleFin(sofiKey, "sofi-savings"), "interest-1"),
        merchantName: "SoFi Interest",
        postedDate: "2026-07-05"
      }),
      expect.objectContaining({
        amount: -42.19,
        categoryId: "cat_food",
        id: transactionIdForSimpleFin(accountIdForSimpleFin(discoverKey, "discover-card"), "grocery-1"),
        merchantName: "Whole Foods",
        status: "posted",
        tags: ["simplefin"]
      })
    ]);
    expect(mapped.newestPostedAt).toBe(1783267200);
  });

  it("parses decimal money strings to cents without float drift at storage precision", () => {
    expect(parseSimpleFinMoney("123.45")).toBe(123.45);
    expect(parseSimpleFinMoney("-0.015")).toBe(-0.02);
    expect(parseSimpleFinMoney("10")).toBe(10);
    expect(() => parseSimpleFinMoney("12.3.4")).toThrow("invalid money string");
  });

  it("keeps credit-card type inference in one heuristic", () => {
    expect(inferSimpleFinAccountType({ balance: 20, name: "SoFi Credit Card", orgName: "SoFi" })).toBe("credit_card");
    expect(inferSimpleFinAccountType({ balance: -10, name: "Vishhvak", orgName: "Discover" })).toBe("credit_card");
    expect(inferSimpleFinAccountType({ balance: 100, name: "Savings", orgName: "SoFi" })).toBe("savings");
    expect(inferSimpleFinAccountType({ balance: 100, name: "Checking", orgName: "SoFi" })).toBe("checking");
  });

  it("puts SoFi and Discover SimpleFIN accounts on standby while healthy Plaid items exist", () => {
    const standby = mapSimpleFinAccountSetToDomain({
      accountSet: createSimpleFinFixture(),
      healthyPlaidInstitutionIds: new Set(["ins_126339", "ins_33"]),
      syncedAt: "2026-07-06T12:00:00.000Z"
    });
    const active = mapSimpleFinAccountSetToDomain({
      accountSet: createSimpleFinFixture(),
      healthyPlaidInstitutionIds: new Set(),
      syncedAt: "2026-07-06T13:00:00.000Z"
    });

    expect(standby.accounts).toEqual([
      expect.objectContaining({
        id: accountIdForSimpleFin("https://sofi.example/simplefin", "sofi-savings"),
        includedInNetWorth: false
      }),
      expect.objectContaining({
        id: accountIdForSimpleFin("discover.com", "discover-card"),
        includedInNetWorth: false
      })
    ]);
    expect(standby.transactions).toEqual([]);
    expect(active.accounts.every((account) => account.includedInNetWorth)).toBe(true);
    expect(active.transactions).toHaveLength(2);
  });

  it("computes first and incremental request windows within the 90 day limit", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const first = computeSimpleFinSyncWindow({ now });
    const incremental = computeSimpleFinSyncWindow({
      lastSuccessfulNewestPosted: Math.floor(new Date("2026-07-01T00:00:00.000Z").getTime() / 1000),
      now
    });
    const capped = computeSimpleFinSyncWindow({
      lastSuccessfulNewestPosted: Math.floor(new Date("2026-01-01T00:00:00.000Z").getTime() / 1000),
      now
    });

    expect(first).toEqual({
      endUnix: 1783339200,
      startUnix: 1779451200
    });
    expect(incremental.startUnix).toBe(1782604800);
    expect(capped.startUnix).toBe(1775563200);
  });
});

describe("SimpleFIN persistence", () => {
  it("preserves transaction overlays across resync while updating provider fields", async () => {
    useTempDb();
    const first = mapSimpleFinAccountSetToDomain({
      accountSet: createSimpleFinFixture(),
      syncedAt: "2026-07-06T12:00:00.000Z"
    });

    await replaceSimpleFinLedgerSnapshot({
      accounts: first.accounts,
      balanceSnapshots: first.balanceSnapshots,
      errors: first.errors,
      finishedAt: "2026-07-06T12:00:00.000Z",
      newestPostedAt: first.newestPostedAt,
      providerConnections: first.providerConnections,
      requestEndUnix: 1783339200,
      requestStartUnix: 1778155200,
      startedAt: "2026-07-06T12:00:00.000Z",
      successful: true,
      transactions: first.transactions
    });

    const groceryTransactionId = transactionIdForSimpleFin(
      accountIdForSimpleFin("discover.com", "discover-card"),
      "grocery-1"
    );
    await updateDbTransaction(groceryTransactionId, {
      categoryId: "cat_shopping",
      notes: "User override survives provider sync.",
      reviewed: true,
      tags: ["manual", "card"]
    });

    const changedFixture = createSimpleFinFixture();
    changedFixture.accounts![1].transactions![0] = {
      ...changedFixture.accounts![1].transactions![0],
      amount: "-45.00",
      description: "WHOLE FOODS UPDATED"
    };
    const second = mapSimpleFinAccountSetToDomain({
      accountSet: changedFixture,
      syncedAt: "2026-07-06T13:00:00.000Z"
    });

    await replaceSimpleFinLedgerSnapshot({
      accounts: second.accounts,
      balanceSnapshots: second.balanceSnapshots,
      errors: second.errors,
      finishedAt: "2026-07-06T13:00:00.000Z",
      newestPostedAt: second.newestPostedAt,
      providerConnections: second.providerConnections,
      requestEndUnix: 1783342800,
      requestStartUnix: 1782604800,
      startedAt: "2026-07-06T13:00:00.000Z",
      successful: true,
      transactions: second.transactions
    });

    const snapshot = await readFinanceDbSnapshot();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === groceryTransactionId);

    expect(transaction).toMatchObject({
      amount: -45,
      categoryId: "cat_shopping",
      description: "WHOLE FOODS UPDATED",
      notes: "User override survives provider sync.",
      reviewed: true,
      tags: ["manual", "card"]
    });
  }, 15_000);

  it("surfaces SimpleFIN errors verbatim and sends one authenticated request", async () => {
    useTempDb();
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.SIMPLEFIN_ACCESS_URL = "https://user%40example.com:p%40ss@beta-bridge.simplefin.org/simplefin";
    const simpleFinError = {
      code: "con.auth",
      conn_id: "discover",
      msg: "Reconnect Discover"
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));
      expect(url.toString()).toMatch(/^https:\/\/beta-bridge\.simplefin\.org\/simplefin\/accounts\?/);
      expect(url.username).toBe("");
      expect(url.searchParams.get("version")).toBe("2");
      expect(url.searchParams.get("start-date")).toBeTruthy();
      expect(url.searchParams.get("end-date")).toBeTruthy();
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from("user@example.com:p@ss").toString("base64")}`
      });

      return new Response(
        JSON.stringify({
          ...createSimpleFinFixture(),
          errors: [simpleFinError]
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncSimpleFinData();
    const snapshot = await readFinanceDbSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([simpleFinError]);
    expect(result.status.lastErrors).toEqual([simpleFinError]);
    expect(snapshot?.providerConnections.filter((connection) => connection.provider === "simplefin")).toEqual([
      expect.objectContaining({ status: "error", errorMessage: "con.auth: Reconnect Discover" }),
      expect.objectContaining({ status: "error", errorMessage: "con.auth: Reconnect Discover" })
    ]);
  }, 15_000);
});

function useTempDb() {
  testDbPath = mkdtempSync(path.join(tmpdir(), "ai-finances-simplefin-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testDbPath, "db");
}

function createSimpleFinFixture(): SimpleFinAccountSet {
  return {
    errors: [],
    accounts: [
      {
        org: {
          name: "SoFi",
          domain: "sofi.com",
          "sfin-url": "https://sofi.example/simplefin"
        },
        id: "sofi-savings",
        name: "Savings",
        currency: "USD",
        balance: "1200.10",
        "available-balance": "1195.10",
        "balance-date": 1783332000,
        transactions: [
          {
            id: "interest-1",
            posted: 1783267200,
            amount: "5.25",
            description: "Interest earned",
            payee: "SoFi Interest"
          }
        ]
      },
      {
        org: {
          domain: "discover.com"
        },
        id: "discover-card",
        name: "Vishhvak",
        currency: "USD",
        balance: "-431.22",
        "balance-date": 1783332300,
        transactions: [
          {
            id: "grocery-1",
            posted: 1783180800,
            amount: "-42.19",
            description: "WHOLE FOODS MARKET",
            payee: "Whole Foods"
          }
        ]
      }
    ]
  };
}
