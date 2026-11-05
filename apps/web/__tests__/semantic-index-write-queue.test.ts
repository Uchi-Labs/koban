// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeFinanceDbForTests,
  createCategory,
  ensureSemanticIndex,
  getSemanticDocumentSummary,
  replaceLedgerInDb,
  updateDbTransaction
} from "@/lib/db/finance-db";
import { setEmbeddingFetchForTests } from "@/lib/embeddings";
import type { Ledger } from "@/lib/finance-data";

let root: string | null = null;

afterEach(async () => {
  setEmbeddingFetchForTests(undefined);
  await closeFinanceDbForTests();
  if (root) {
    rmSync(root, { force: true, recursive: true });
    root = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_LEDGER_BACKUP_PATH;
  delete process.env.VOYAGE_API_KEY;
});

describe("semantic index refresh", () => {
  it("does not hold the write queue while the embedding provider is pending", async () => {
    root = mkdtempSync(path.join(tmpdir(), "koban-semantic-queue-"));
    process.env.AI_FINANCES_PGLITE_DIR = path.join(root, "db");
    process.env.AI_FINANCES_LEDGER_BACKUP_PATH = path.join(root, "ledger-backup.json");
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    await replaceLedgerInDb(createLedger());

    process.env.VOYAGE_API_KEY = "test-voyage-key";
    let embedCalled: () => void = () => undefined;
    const embedStarted = new Promise<void>((resolve) => {
      embedCalled = resolve;
    });
    let finishEmbedding: () => void = () => undefined;
    const embeddingGate = new Promise<void>((resolve) => {
      finishEmbedding = resolve;
    });
    setEmbeddingFetchForTests(async (_input, init) => {
      const input = (JSON.parse(String(init?.body ?? "{}")) as { input?: string[] }).input ?? [];
      embedCalled();
      await embeddingGate;
      return voyageResponse(input.length);
    });

    const refresh = ensureSemanticIndex();
    await embedStarted;

    // Before the fix these writes waited behind the pending provider call.
    await createCategory({ name: "Edited during embedding" });
    const edited = await updateDbTransaction("txn_1", { notes: "Edited while the embedding was pending." });
    expect(edited?.notes).toBe("Edited while the embedding was pending.");

    finishEmbedding();
    const result = await refresh;

    // txn_1's document changed after it was read, so its stale embedding is skipped.
    expect(result.documentsEmbedded).toBe(0);
    expect((await getSemanticDocumentSummary()).transactionEmbeddingCount).toBe(0);
  }, 15_000);
});

function voyageResponse(count: number): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, () => ({ embedding: Array.from({ length: 1024 }, () => 0.01) })),
      usage: { total_tokens: count }
    }),
    { headers: { "content-type": "application/json" }, status: 200 }
  );
}

function createLedger(): Ledger {
  const providerConnection = {
    configured: true,
    displayName: "Plaid - Test Bank",
    id: "provider_plaid_test",
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    provider: "plaid",
    status: "connected"
  } satisfies ProviderConnection;
  const account = {
    availableBalance: 900,
    currency: "USD",
    currentBalance: 1000,
    groupId: "group_cash",
    id: "acct_1",
    includedInNetWorth: true,
    institutionName: "Test Bank",
    lastUpdatedAt: "2026-05-31T00:00:00.000Z",
    name: "Checking",
    providerConnectionId: providerConnection.id,
    type: "checking"
  } satisfies Account;
  const transaction = {
    accountId: account.id,
    amount: -12.34,
    categoryId: "cat_food",
    currency: "USD",
    date: "2026-05-30",
    description: "DINNER PLACE",
    id: "txn_1",
    merchantName: "Dinner Place",
    postedDate: "2026-05-30",
    providerConnectionId: providerConnection.id,
    reviewed: false,
    status: "posted",
    tags: ["plaid"]
  } satisfies Transaction;

  return {
    accounts: [account],
    enrollmentCount: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    providerConnections: [providerConnection],
    source: "koban",
    syncStartDate: "2026-01-01",
    syncSummary: { accountCount: 1, errors: [], transactionCount: 1 },
    transactions: [transaction],
    version: 1
  };
}
