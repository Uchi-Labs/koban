// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PATCH as patchTransactionTags } from "@/app/api/v1/transactions/[transactionId]/tags/route";
import {
  closeFinanceDbForTests,
  createTransactionContextNote,
  listTransactionEvidence,
  modifyTransactionTags,
  readFinanceDbSnapshot,
  replaceLedgerInDb,
  TransactionTagLimitError,
  updateDbTransaction,
  updateTransactionEvidenceStatus
} from "@/lib/db/finance-db";
import type { Ledger } from "@/lib/finance-data";

let testRoot: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  delete process.env.AI_FINANCES_LEDGER_BACKUP_PATH;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = null;
  }
});

describe("atomic transaction tag changes", () => {
  it("preserves agent tags, category, notes and accepted context across provider resync", async () => {
    await seedTags(["existing"]);
    await updateDbTransaction("txn_1", {
      categoryId: "cat_travel", notes: "Existing trip note.", reviewed: true
    });
    await modifyTransactionTags("txn_1", { add: ["context-reviewed"], remove: [] });
    const context = await createTransactionContextNote({ body: "Receipt supports this trip expense.", transactionId: "txn_1" });
    expect(context).not.toBeNull();

    const refreshed = createLedger();
    await replaceLedgerInDb({
      ...refreshed,
      transactions: refreshed.transactions.map((transaction) => ({ ...transaction, amount: -18.5 }))
    });

    expect((await readFinanceDbSnapshot())?.transactions[0]).toMatchObject({
      amount: -18.5,
      categoryId: "cat_travel",
      notes: "Existing trip note.",
      reviewed: true,
      tags: ["existing", "context-reviewed"]
    });
    expect(await listTransactionEvidence({ transactionId: "txn_1" })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "accepted",
        relationship: "user_context",
        sourceItem: expect.objectContaining({ id: context?.sourceItem.id })
      })
    ]));
  });

  it("preserves a dismissed evidence decision across provider resync", async () => {
    await seedTags([]);
    const context = await createTransactionContextNote({ body: "Not relevant to this charge.", transactionId: "txn_1" });
    if (!context) throw new Error("Expected context note creation to succeed.");
    await updateTransactionEvidenceStatus({
      relationship: "user_context",
      sourceItemId: context.sourceItem.id,
      status: "dismissed",
      transactionId: "txn_1"
    });

    await replaceLedgerInDb(createLedger());

    expect(await listTransactionEvidence({ includeDismissed: true, transactionId: "txn_1" }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceItem: expect.objectContaining({ id: context.sourceItem.id }), status: "dismissed" })
      ]));
  });

  it("does not restore suggested links or links whose transaction was removed", async () => {
    await seedTags([]);
    const suggested = await createTransactionContextNote({ body: "Tentative context.", transactionId: "txn_1" });
    if (!suggested) throw new Error("Expected suggested context creation to succeed.");
    await updateTransactionEvidenceStatus({
      relationship: "user_context",
      sourceItemId: suggested.sourceItem.id,
      status: "suggested",
      transactionId: "txn_1"
    });
    await replaceLedgerInDb(createLedger());
    expect(await listTransactionEvidence({ includeDismissed: true, transactionId: "txn_1" })).toEqual([]);

    const accepted = await createTransactionContextNote({ body: "Accepted but transaction removed.", transactionId: "txn_1" });
    expect(accepted).not.toBeNull();
    const withoutTransaction = createLedger();
    await replaceLedgerInDb({
      ...withoutTransaction,
      transactions: [],
      syncSummary: { ...withoutTransaction.syncSummary, transactionCount: 0 }
    });
    expect(await listTransactionEvidence({ includeDismissed: true, transactionId: "txn_1" })).toEqual([]);
  });

  it("removes before enforcing the 20-tag limit so a swap keeps its addition", async () => {
    await seedTags(Array.from({ length: 20 }, (_, index) => `tag-${index}`));

    const updated = await modifyTransactionTags("txn_1", { add: ["new-tag"], remove: ["tag-0"] });

    expect(updated?.tags).toHaveLength(20);
    expect(updated?.tags).toContain("new-tag");
    expect(updated?.tags).not.toContain("tag-0");
  });

  it("rejects overflow and rolls the complete mutation back", async () => {
    const original = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
    await seedTags(original);

    await expect(modifyTransactionTags("txn_1", { add: ["overflow"], remove: [] }))
      .rejects.toBeInstanceOf(TransactionTagLimitError);

    expect(await currentTags()).toEqual(original);
  });

  it("returns a meaningful 400 when a tag change would exceed the domain limit", async () => {
    const original = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
    await seedTags(original);

    const response = await patchTransactionTags(tagRequest({ add: ["overflow"] }), {
      params: Promise.resolve({ transactionId: "txn_1" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Transactions can have at most 20 tags." });
    expect(await currentTags()).toEqual(original);
  });

  it("rejects empty add and remove arrays at the HTTP boundary", async () => {
    await seedTags(["existing"]);

    const response = await patchTransactionTags(tagRequest({ add: [], remove: [] }), {
      params: Promise.resolve({ transactionId: "txn_1" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Provide at least one tag to add or remove." });
  });

  it("serializes concurrent additions without losing either change", async () => {
    await seedTags(["existing"]);

    await Promise.all([
      modifyTransactionTags("txn_1", { add: ["alpha"], remove: [] }),
      modifyTransactionTags("txn_1", { add: ["beta"], remove: [] })
    ]);

    expect(await currentTags()).toEqual(["existing", "alpha", "beta"]);
  });

  it("lets removal win when the same normalized tag is also added", async () => {
    await seedTags(["plaid", "same"]);

    const updated = await modifyTransactionTags("txn_1", {
      add: [" same ", "Case", "case", "CASE"],
      remove: ["same"]
    });

    expect(updated?.tags).toEqual(["plaid", "Case", "case", "CASE"]);
  });
});

async function seedTags(tags: string[]): Promise<void> {
  testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-transaction-tags-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testRoot, "pglite");
  process.env.AI_FINANCES_LEDGER_BACKUP_PATH = path.join(testRoot, "ledger.json");
  await replaceLedgerInDb(createLedger());
  await updateDbTransaction("txn_1", { tags });
}

async function currentTags(): Promise<string[] | undefined> {
  return (await readFinanceDbSnapshot())?.transactions.find(({ id }) => id === "txn_1")?.tags;
}

function tagRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/v1/transactions/txn_1/tags", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH"
  });
}

function createLedger(): Ledger {
  const providerConnection = {
    id: "provider_plaid_test",
    provider: "plaid",
    displayName: "Plaid - Test Bank",
    status: "connected",
    configured: true,
    lastSyncedAt: "2026-05-31T00:00:00.000Z"
  } satisfies ProviderConnection;
  const account = {
    id: "acct_1",
    providerConnectionId: providerConnection.id,
    groupId: "group_cash",
    name: "Checking",
    institutionName: "Test Bank",
    type: "checking",
    currency: "USD",
    currentBalance: 1000,
    includedInNetWorth: true,
    lastUpdatedAt: "2026-05-31T00:00:00.000Z"
  } satisfies Account;
  const transaction = {
    id: "txn_1",
    accountId: account.id,
    providerConnectionId: providerConnection.id,
    date: "2026-05-30",
    merchantName: "Dinner Place",
    description: "DINNER PLACE",
    amount: -12.34,
    currency: "USD",
    categoryId: "cat_food",
    status: "posted",
    reviewed: false,
    tags: []
  } satisfies Transaction;

  return {
    source: "koban",
    version: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    syncStartDate: "2026-01-01",
    enrollmentCount: 1,
    accounts: [account],
    providerConnections: [providerConnection],
    transactions: [transaction],
    syncSummary: { accountCount: 1, transactionCount: 1, errors: [] }
  };
}
