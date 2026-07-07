// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST as postFinanceKitIngest } from "@/app/api/v1/financekit/ingest/route";
import {
  closeFinanceDbForTests,
  readFinanceDbSnapshot,
  readSyncStateValue,
  updateDbTransaction
} from "@/lib/db/finance-db";
import {
  accountIdForFinanceKit,
  financeKitLastIngestedStateKey,
  ingestFinanceKitPayload,
  mapFinanceKitIngestToDomain,
  transactionIdForFinanceKit,
  type FinanceKitIngestInput
} from "@/lib/financekit-server";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  delete process.env.AI_FINANCES_AUTH_TOKEN;
  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.DATABASE_URL;
});

describe("FinanceKit mapping", () => {
  it("maps credit-card and asset signs from FinanceKit positive amounts", () => {
    const mapped = mapFinanceKitIngestToDomain(createFinanceKitFixture(), "2026-07-06T12:00:00.000Z");

    expect(mapped.accounts).toEqual([
      expect.objectContaining({
        currentBalance: -431.22,
        groupId: "group_credit",
        id: accountIdForFinanceKit("apple-card-account"),
        institutionName: "Apple",
        type: "credit_card"
      }),
      expect.objectContaining({
        currentBalance: 1200.1,
        groupId: "group_cash",
        id: accountIdForFinanceKit("apple-savings-account"),
        type: "savings"
      })
    ]);
    expect(mapped.transactions).toEqual([
      expect.objectContaining({
        amount: -42.19,
        id: transactionIdForFinanceKit("card-debit"),
        status: "posted",
        tags: ["financekit"]
      }),
      expect.objectContaining({
        amount: 15,
        id: transactionIdForFinanceKit("card-credit")
      }),
      expect.objectContaining({
        amount: -25,
        id: transactionIdForFinanceKit("asset-debit")
      }),
      expect.objectContaining({
        amount: 5.25,
        id: transactionIdForFinanceKit("asset-credit")
      })
    ]);
    expect(mapped.balanceSnapshots).toEqual([
      expect.objectContaining({
        accountId: accountIdForFinanceKit("apple-card-account"),
        ledgerBalance: -431.22,
        source: "financekit"
      }),
      expect.objectContaining({
        accountId: accountIdForFinanceKit("apple-savings-account"),
        ledgerBalance: 1200.1,
        source: "financekit"
      })
    ]);
  });
});

describe("FinanceKit persistence", () => {
  it("idempotently re-ingests overlapping batches while preserving user overlays", async () => {
    useTempDb();
    const input = createFinanceKitFixture();
    const first = await ingestFinanceKitPayload(input, new Date("2026-07-06T12:00:00.000Z"));
    const transactionId = transactionIdForFinanceKit("card-debit");

    expect(first).toMatchObject({
      accountsUpserted: 2,
      transactionsAdded: 4,
      transactionsUnchanged: 0,
      transactionsUpdated: 0
    });

    await updateDbTransaction(transactionId, {
      categoryId: "cat_shopping",
      notes: "Apple Card override survives.",
      reviewed: true,
      tags: ["manual", "card"]
    });

    const second = await ingestFinanceKitPayload(input, new Date("2026-07-06T13:00:00.000Z"));
    const snapshot = await readFinanceDbSnapshot();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === transactionId);

    expect(second).toMatchObject({
      accountsUpserted: 2,
      transactionsAdded: 0,
      transactionsUnchanged: 4,
      transactionsUpdated: 0
    });
    expect(transaction).toMatchObject({
      amount: -42.19,
      categoryId: "cat_shopping",
      notes: "Apple Card override survives.",
      reviewed: true,
      tags: ["manual", "card"]
    });
    await expect(readSyncStateValue(financeKitLastIngestedStateKey)).resolves.toBe("2026-07-06T13:00:00.000Z");
  }, 15_000);
});

describe("FinanceKit ingest route", () => {
  it("returns deliberate 400s for malformed bodies", async () => {
    const response = await postFinanceKitIngest(
      new Request("http://localhost/api/v1/financekit/ingest", {
        body: JSON.stringify({
          accounts: [
            {
              id: "apple-card-account",
              display_name: "Apple Card",
              type: "credit",
              currency: "USD"
            }
          ],
          transactions: [
            {
              id: "missing-amount",
              account_id: "apple-card-account",
              currency: "USD",
              credit_debit: "debit",
              posted_date: "2026-07-05"
            }
          ]
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({
      error: "transactions[0] must include amount_minor or amount."
    });
    expect(response.status).toBe(400);
  });
});

function useTempDb() {
  testDbPath = mkdtempSync(path.join(tmpdir(), "ai-finances-financekit-"));
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testDbPath, "db");
}

function createFinanceKitFixture(): FinanceKitIngestInput {
  return {
    deviceName: "Vish iPhone",
    accounts: [
      {
        id: "apple-card-account",
        displayName: "Apple Card",
        institutionName: "Apple",
        type: "credit",
        currency: "USD",
        balance: 431.22,
        balanceAsOf: "2026-07-06T10:00:00.000Z"
      },
      {
        id: "apple-savings-account",
        displayName: "Apple Savings",
        institutionName: "Apple",
        type: "asset",
        currency: "USD",
        balance: 1200.1,
        balanceAsOf: "2026-07-06T10:05:00.000Z"
      }
    ],
    transactions: [
      {
        id: "card-debit",
        accountId: "apple-card-account",
        amountMinor: 4219,
        creditDebit: "debit",
        currency: "USD",
        description: "WHOLE FOODS MARKET",
        merchantName: "Whole Foods",
        pending: false,
        postedDate: "2026-07-05"
      },
      {
        id: "card-credit",
        accountId: "apple-card-account",
        amount: 15,
        creditDebit: "credit",
        currency: "USD",
        description: "APPLE CARD CASHBACK",
        merchantName: "Daily Cash",
        pending: false,
        postedDate: "2026-07-05"
      },
      {
        id: "asset-debit",
        accountId: "apple-savings-account",
        amount: 25,
        creditDebit: "debit",
        currency: "USD",
        description: "TRANSFER OUT",
        merchantName: "Transfer",
        pending: false,
        postedDate: "2026-07-04"
      },
      {
        id: "asset-credit",
        accountId: "apple-savings-account",
        amount: 5.25,
        creditDebit: "credit",
        currency: "USD",
        description: "INTEREST",
        merchantName: "Apple Savings Interest",
        pending: false,
        postedDate: "2026-07-03"
      }
    ]
  };
}
