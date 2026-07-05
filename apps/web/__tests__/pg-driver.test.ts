// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeFinanceDbForTests,
  readFinanceDbSnapshot,
  replaceTellerLedgerInDb,
  resetLocalAppData,
  semanticSearchTransactions,
  updateDbTransaction
} from "@/lib/db/finance-db";
import type { TellerLedger } from "@/lib/finance-data";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres("postgres finance db driver", () => {
  beforeEach(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    delete process.env.AI_FINANCES_PGLITE_DIR;
    await closeFinanceDbForTests();
    await resetLocalAppData();
  });

  afterEach(async () => {
    await resetLocalAppData().catch(() => undefined);
    await closeFinanceDbForTests();
    delete process.env.DATABASE_URL;
  });

  it("bootstraps schema, writes and reads rows, and preserves transaction overlays", async () => {
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const updated = await updateDbTransaction("txn_pg_1", {
      categoryId: "cat_travel",
      notes: "Dinner on the Denver trip.",
      reviewed: true,
      tags: ["trip", "dinner"]
    });

    expect(updated).toMatchObject({
      categoryId: "cat_travel",
      notes: "Dinner on the Denver trip.",
      reviewed: true,
      tags: ["trip", "dinner"]
    });

    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -18.5, providerCategoryId: "cat_food" }));

    const snapshot = await readFinanceDbSnapshot();
    const searchResults = await semanticSearchTransactions("Denver dinner trip", 5);
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === "txn_pg_1");

    expect(snapshot?.accounts).toHaveLength(1);
    expect(snapshot?.providerConnections).toHaveLength(1);
    expect(transaction).toMatchObject({
      amount: -18.5,
      categoryId: "cat_travel",
      notes: "Dinner on the Denver trip.",
      reviewed: true,
      tags: ["trip", "dinner"]
    });
    expect(searchResults[0]).toMatchObject({
      resourceId: "txn_pg_1",
      resourceType: "transaction"
    });
  }, 20_000);
});

function createLedger({
  providerCategoryId,
  transactionAmount
}: {
  providerCategoryId: string;
  transactionAmount: number;
}): TellerLedger {
  const providerConnection = {
    id: "provider_teller_pg_test",
    provider: "teller",
    displayName: "Teller - Postgres Test Bank",
    status: "connected",
    configured: true,
    lastSyncedAt: "2026-05-31T00:00:00.000Z"
  } satisfies ProviderConnection;
  const account = {
    id: "acct_pg_1",
    providerConnectionId: providerConnection.id,
    groupId: "group_cash",
    name: "Checking",
    institutionName: "Postgres Test Bank",
    type: "checking",
    currency: "USD",
    currentBalance: 1000.25,
    availableBalance: 900.25,
    includedInNetWorth: true,
    lastUpdatedAt: "2026-05-31T00:00:00.000Z"
  } satisfies Account;
  const transaction = {
    id: "txn_pg_1",
    accountId: account.id,
    providerConnectionId: providerConnection.id,
    date: "2026-05-30",
    postedDate: "2026-05-30",
    merchantName: "Dinner Place",
    description: "DINNER PLACE",
    amount: transactionAmount,
    currency: "USD",
    categoryId: providerCategoryId,
    status: "posted",
    reviewed: false,
    tags: ["teller"]
  } satisfies Transaction;

  return {
    source: "teller",
    version: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    syncStartDate: "2026-01-01",
    enrollmentCount: 1,
    accounts: [account],
    providerConnections: [providerConnection],
    transactions: [transaction],
    syncSummary: {
      accountCount: 1,
      transactionCount: 1,
      errors: []
    }
  };
}
