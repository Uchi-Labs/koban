// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST as postBatchSuggestions } from "@/app/api/v1/enrichment/suggestions/batch/route";
import {
  closeFinanceDbForTests,
  listEnrichmentSuggestions,
  readFinanceDbSnapshot,
  replaceTellerLedgerInDb
} from "@/lib/db/finance-db";
import { generateEnrichmentSuggestions } from "@/lib/enrichment-runs";
import type { TellerLedger } from "@/lib/finance-data";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.AI_FINANCES_LLM_BASE_URL;
  delete process.env.AI_FINANCES_LLM_MODEL;
  delete process.env.AI_FINANCES_LLM_PROVIDER;
  delete process.env.AI_FINANCES_LLM_REASONING_MODEL;
  delete process.env.AI_FINANCES_LLM_SIMPLE_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_TELLER_BACKUP_PATH;
});

describe("enrichment suggestions batch API", () => {
  it("batch accepts suggestions and mutates target transactions", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createRepeatedMerchantLedger());
    await generateEnrichmentSuggestions(20);
    const suggestions = await listEnrichmentSuggestions();
    const categorySuggestion = suggestions.find(
      (suggestion) => suggestion.action === "set_category" && suggestion.categoryId === "cat_software"
    );

    expect(categorySuggestion).toBeTruthy();

    const response = await postBatchSuggestions(jsonRequest({
      action: "accept",
      suggestion_ids: [categorySuggestion!.id]
    }));
    const body = (await response.json()) as {
      applied?: Array<{ id?: string; suggestion?: { id?: string; status?: string } }>;
      data?: unknown[];
      failed?: unknown[];
      object?: string;
    };
    const snapshot = await readFinanceDbSnapshot();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === categorySuggestion?.transactionId);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: "list",
      failed: []
    });
    expect(body.data).toHaveLength(1);
    expect(body.applied?.[0]).toMatchObject({
      id: categorySuggestion!.id,
      suggestion: {
        id: categorySuggestion!.id,
        status: "applied"
      }
    });
    expect(transaction).toMatchObject({
      categoryId: "cat_software"
    });
  }, 15_000);

  it("returns partial results for mixed valid and invalid ids", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createRepeatedMerchantLedger());
    await generateEnrichmentSuggestions(20);
    const suggestions = await listEnrichmentSuggestions();
    const tagSuggestion = suggestions.find((suggestion) => suggestion.action === "add_tags");

    expect(tagSuggestion).toBeTruthy();

    const response = await postBatchSuggestions(jsonRequest({
      action: "dismiss",
      suggestion_ids: [tagSuggestion!.id, "missing_suggestion"]
    }));
    const body = (await response.json()) as {
      applied?: Array<{ id?: string; suggestion?: { id?: string; status?: string } }>;
      failed?: Array<{ error?: string; id?: string }>;
    };
    const remainingSuggestions = await listEnrichmentSuggestions();

    expect(response.status).toBe(200);
    expect(body.applied).toHaveLength(1);
    expect(body.applied?.[0]).toMatchObject({
      id: tagSuggestion!.id,
      suggestion: {
        id: tagSuggestion!.id,
        status: "dismissed"
      }
    });
    expect(body.failed).toEqual([
      {
        error: "Suggestion not found or already resolved.",
        id: "missing_suggestion"
      }
    ]);
    expect(remainingSuggestions.some((suggestion) => suggestion.id === tagSuggestion?.id)).toBe(false);
  }, 15_000);

  it("rejects batches over 200 ids before doing work", async () => {
    const response = await postBatchSuggestions(jsonRequest({
      action: "accept",
      suggestion_ids: Array.from({ length: 201 }, (_value, index) => `suggestion_${index}`)
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "suggestion_ids cannot include more than 200 ids."
    });
  });
});

function useTempDb() {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-pglite-")), "db");
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_TELLER_BACKUP_PATH = path.join(path.dirname(testDbPath), "teller-ledger-backup.json");
  delete process.env.AI_FINANCES_LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;
}

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/v1/enrichment/suggestions/batch", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

function createRepeatedMerchantLedger(): TellerLedger {
  const providerConnection = {
    id: "provider_teller_test",
    provider: "teller",
    displayName: "Teller - Test Bank",
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
    currentBalance: 1000.25,
    availableBalance: 900.25,
    includedInNetWorth: true,
    lastUpdatedAt: "2026-05-31T00:00:00.000Z"
  } satisfies Account;
  const baseTransaction = {
    id: "txn_1",
    accountId: account.id,
    providerConnectionId: providerConnection.id,
    date: "2026-05-30",
    postedDate: "2026-05-30",
    merchantName: "OPENAI OPENAI",
    description: "OPENAI SUBSCRIPTION",
    amount: -20,
    currency: "USD",
    categoryId: "cat_other",
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
    transactions: [
      baseTransaction,
      {
        ...baseTransaction,
        amount: -21,
        date: "2026-05-29",
        id: "txn_2",
        postedDate: "2026-05-29"
      },
      {
        ...baseTransaction,
        amount: -22,
        date: "2026-05-28",
        id: "txn_3",
        postedDate: "2026-05-28"
      }
    ],
    syncSummary: {
      accountCount: 1,
      transactionCount: 3,
      errors: []
    }
  };
}
