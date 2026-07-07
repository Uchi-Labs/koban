// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import type { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DELETE as deleteGoalRoute, PATCH as patchGoalRoute } from "@/app/api/v1/goals/[goalId]/route";
import { GET as getGoalsRoute, POST as postGoalRoute } from "@/app/api/v1/goals/route";
import { PATCH as patchTransactionRoute } from "@/app/api/v1/transactions/[transactionId]/route";
import {
  closeFinanceDbForTests,
  createFinancialGoal,
  deleteFinancialGoal,
  listFinancialGoals,
  readFinanceDbSnapshot,
  replaceTellerLedgerInDb,
  setTransactionFinancialGoal,
  updateFinancialGoal
} from "@/lib/db/finance-db";
import type { TellerLedger } from "@/lib/finance-data";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_TELLER_BACKUP_PATH;
});

describe("financial goals db layer", () => {
  it("creates goals and computes sign-normalized saved totals plus transaction counts", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const goal = await createFinancialGoal({ name: "Emergency fund", emoji: "🛟", targetAmountMinor: 500_00 });
    const assigned = await setTransactionFinancialGoal("txn_1", goal.id);

    expect(assigned).toMatchObject({ id: "txn_1", financialGoalId: goal.id });

    const goals = await listFinancialGoals();

    // Outflow of -1234 cents becomes +1234 saved (money set aside reads positive).
    expect(goals).toEqual([
      expect.objectContaining({
        id: goal.id,
        name: "Emergency fund",
        emoji: "🛟",
        targetAmountMinor: 500_00,
        savedAmountMinor: 1234,
        transactionCount: 1,
        state: "active"
      })
    ]);
  });

  it("nets an income/withdrawal against outflow contributions", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createTwoTransactionLedger(-100, 40));

    const goal = await createFinancialGoal({ name: "Vacation" });
    await setTransactionFinancialGoal("txn_out", goal.id);
    await setTransactionFinancialGoal("txn_in", goal.id);

    const goals = await listFinancialGoals();

    // -(-100) + -(40) = 100 - 40 = 60 saved, across 2 assigned transactions.
    expect(goals[0]).toMatchObject({ savedAmountMinor: 60_00, transactionCount: 2 });
  });

  it("renames, retargets, and archives goals", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));
    const goal = await createFinancialGoal({ name: "Car" });

    const updated = await updateFinancialGoal(goal.id, {
      name: "New car",
      emoji: "🚗",
      targetAmountMinor: 2_000_00,
      state: "archived"
    });

    expect(updated).toMatchObject({
      id: goal.id,
      name: "New car",
      emoji: "🚗",
      targetAmountMinor: 2_000_00,
      state: "archived"
    });
  });

  it("deletes a goal by unassigning its transactions instead of deleting them", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));
    const goal = await createFinancialGoal({ name: "Doomed" });
    await setTransactionFinancialGoal("txn_1", goal.id);

    const deleted = await deleteFinancialGoal(goal.id);
    const snapshot = await readFinanceDbSnapshot();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === "txn_1");

    expect(deleted).toBe(true);
    expect(await listFinancialGoals()).toEqual([]);
    // Transaction survives; only its assignment was cleared.
    expect(transaction).toMatchObject({ id: "txn_1" });
    expect(transaction?.financialGoalId).toBeUndefined();
  });

  it("preserves a goal assignment across a provider resync", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));
    const goal = await createFinancialGoal({ name: "Rainy day" });
    await setTransactionFinancialGoal("txn_1", goal.id);

    // Provider re-upserts the same transaction with fresh data (no goal knowledge).
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -18.5, providerCategoryId: "cat_food" }));

    const snapshot = await readFinanceDbSnapshot();
    const transaction = snapshot?.transactions.find((candidate) => candidate.id === "txn_1");
    const goals = await listFinancialGoals();

    expect(transaction).toMatchObject({ id: "txn_1", amount: -18.5, financialGoalId: goal.id });
    expect(goals[0]).toMatchObject({ savedAmountMinor: 1850, transactionCount: 1 });
  });
});

describe("financial goals API", () => {
  it("lists, creates, and shapes goals in the Stripe-style envelope", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const createResponse = await postGoalRoute(
      jsonRequest("http://localhost/api/v1/goals", { name: "House", emoji: "🏠", target_amount_cents: 10_000_00 })
    );
    const created = (await createResponse.json()) as { id: string; saved_amount_cents: number; target_amount_cents: number };

    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({
      object: "financial_goal",
      name: "House",
      emoji: "🏠",
      target_amount_cents: 10_000_00,
      saved_amount_cents: 0,
      state: "active"
    });

    await setTransactionFinancialGoal("txn_1", created.id);

    const listResponse = await getGoalsRoute();
    const list = (await listResponse.json()) as {
      data: Array<{ id: string; saved_amount_cents: number; transaction_count: number }>;
      object: string;
    };

    expect(list.object).toBe("list");
    expect(list.data).toEqual([
      expect.objectContaining({ id: created.id, saved_amount_cents: 1234, transaction_count: 1 })
    ]);
  });

  it("rejects a blank goal name with 400", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const response = await postGoalRoute(jsonRequest("http://localhost/api/v1/goals", { name: "   " }));
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("patches and deletes goals through the id route", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));
    const goal = await createFinancialGoal({ name: "Bike" });

    const patchResponse = await patchGoalRoute(
      jsonRequest(`http://localhost/api/v1/goals/${goal.id}`, { name: "E-bike", state: "archived" }),
      { params: Promise.resolve({ goalId: goal.id }) }
    );
    const patched = (await patchResponse.json()) as { name: string; state: string };

    expect(patchResponse.status).toBe(200);
    expect(patched).toMatchObject({ name: "E-bike", state: "archived" });

    const deleteResponse = await deleteGoalRoute(new Request(`http://localhost/api/v1/goals/${goal.id}`), {
      params: Promise.resolve({ goalId: goal.id })
    });

    expect(deleteResponse.status).toBe(200);
    expect(await listFinancialGoals()).toEqual([]);
  });

  it("returns 404 when patching an unknown goal", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const response = await patchGoalRoute(
      jsonRequest("http://localhost/api/v1/goals/goal_missing", { name: "Nope" }),
      { params: Promise.resolve({ goalId: "goal_missing" }) }
    );

    expect(response.status).toBe(404);
  });

  it("assigns and unassigns a transaction goal through the transaction PATCH route", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));
    const goal = await createFinancialGoal({ name: "Wedding" });

    const assignResponse = await patchTransactionRoute(
      jsonRequest("http://localhost/api/v1/transactions/txn_1", { financial_goal_id: goal.id }) as NextRequest,
      { params: Promise.resolve({ transactionId: "txn_1" }) }
    );
    const assigned = (await assignResponse.json()) as { financial_goal_id: string | null };

    expect(assignResponse.status).toBe(200);
    expect(assigned.financial_goal_id).toBe(goal.id);

    const unassignResponse = await patchTransactionRoute(
      jsonRequest("http://localhost/api/v1/transactions/txn_1", { financial_goal_id: null }) as NextRequest,
      { params: Promise.resolve({ transactionId: "txn_1" }) }
    );
    const unassigned = (await unassignResponse.json()) as { financial_goal_id: string | null };

    expect(unassignResponse.status).toBe(200);
    expect(unassigned.financial_goal_id).toBeNull();
  });

  it("rejects assigning a transaction to an unknown goal with 400", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createLedger({ transactionAmount: -12.34, providerCategoryId: "cat_food" }));

    const response = await patchTransactionRoute(
      jsonRequest("http://localhost/api/v1/transactions/txn_1", { financial_goal_id: "goal_missing" }) as NextRequest,
      { params: Promise.resolve({ transactionId: "txn_1" }) }
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH"
  });
}

function useTempDb() {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-goals-")), "db");
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_TELLER_BACKUP_PATH = path.join(path.dirname(testDbPath), "teller-ledger-backup.json");
}

function createLedger({
  description = "DINNER PLACE",
  merchantName = "Dinner Place",
  providerCategoryId,
  transactionAmount
}: {
  description?: string;
  merchantName?: string;
  providerCategoryId: string;
  transactionAmount: number;
}): TellerLedger {
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
  const transaction = {
    id: "txn_1",
    accountId: account.id,
    providerConnectionId: providerConnection.id,
    date: "2026-05-30",
    postedDate: "2026-05-30",
    merchantName,
    description,
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
    syncSummary: { accountCount: 1, transactionCount: 1, errors: [] }
  };
}

function createTwoTransactionLedger(outflowAmount: number, inflowAmount: number): TellerLedger {
  const ledger = createLedger({ transactionAmount: outflowAmount, providerCategoryId: "cat_transfer" });
  const base = ledger.transactions[0];

  return {
    ...ledger,
    transactions: [
      { ...base, id: "txn_out", amount: outflowAmount },
      { ...base, id: "txn_in", amount: inflowAmount, date: "2026-05-29", postedDate: "2026-05-29" }
    ],
    syncSummary: { accountCount: 1, transactionCount: 2, errors: [] }
  };
}
