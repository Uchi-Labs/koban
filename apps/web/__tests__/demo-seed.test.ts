import { describe, expect, it } from "vitest";
import {
  assertDemoDatabasePreflight,
  assertDemoDataset,
  assertDemoSeedTarget,
  createDemoDataset,
  demoSeedConfirmation
} from "@/lib/demo-seed";
import { createRecurringItems } from "@/lib/finance-data";

describe("demo seed", () => {
  it("builds the same rich fake ledger on every run", () => {
    const first = createDemoDataset();
    const second = createDemoDataset();

    expect(second).toEqual(first);
    expect(first.ledger.accounts).toHaveLength(15);
    expect(first.ledger.transactions.length).toBeGreaterThan(2_000);
    expect(first.subscriptionNames).toHaveLength(11);
    expect(first.investmentPositions).toHaveLength(8);
    expect(first.goals).toHaveLength(3);
    expect(first.ledger.transactions.some((transaction) => !transaction.reviewed)).toBe(true);
    expect(new Set(first.ledger.transactions.map((transaction) => transaction.date.slice(0, 7)))).toHaveLength(24);
    expect(new Set(first.ledger.accounts.map((account) => account.type))).toEqual(new Set(["checking", "savings", "credit_card", "investment", "loan", "cash"]));
    expect(createRecurringItems(first.ledger.transactions).length).toBeGreaterThanOrEqual(8);
    expect(createRecurringItems(first.ledger.transactions).length).toBeLessThanOrEqual(15);
    expect(() => assertDemoDataset(first)).not.toThrow();
  });

  it("pairs every internal transfer symmetrically", () => {
    const transactions = createDemoDataset().ledger.transactions;
    const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const paired = transactions.filter((transaction) => transaction.pairedTransactionId);

    expect(paired.length).toBeGreaterThan(100);
    for (const transaction of paired) {
      const counterpart = byId.get(transaction.pairedTransactionId!);
      expect(counterpart?.pairedTransactionId).toBe(transaction.id);
      expect(counterpart?.amount).toBe(-transaction.amount);
      expect(counterpart?.categoryId).toBe("cat_transfer");
    }
  });

  it("requires a separate, explicitly acknowledged demo-named Postgres target", () => {
    const valid = "postgresql://demo.invalid/ai_finances_demo";
    expect(assertDemoSeedTarget({ confirmation: demoSeedConfirmation, demoDatabaseUrl: valid }).pathname).toBe("/ai_finances_demo");
    expect(() => assertDemoSeedTarget({ confirmation: demoSeedConfirmation, demoDatabaseUrl: "postgresql://demo.invalid/finance" })).toThrow(/must contain 'demo'/);
    expect(() => assertDemoSeedTarget({ confirmation: "yes", demoDatabaseUrl: valid })).toThrow(/AI_FINANCES_DEMO_SEED_CONFIRM/);
    expect(() => assertDemoSeedTarget({ confirmation: demoSeedConfirmation, demoDatabaseUrl: valid, workspaceDatabaseUrl: valid })).toThrow(/matches the workspace/);
    expect(() => assertDemoSeedTarget({ confirmation: demoSeedConfirmation, demoDatabaseUrl: "file:///tmp/demo" })).toThrow(/postgres:\/\//);
  });

  it("preflights ownership before any migration or destructive write", () => {
    expect(assertDemoDatabasePreflight({ tableNames: [], marker: undefined, nonDemoRowCounts: {}, users: [] })).toBe("empty");
    expect(() => assertDemoDatabasePreflight({ tableNames: ["mystery"], marker: undefined, nonDemoRowCounts: {}, users: [] })).toThrow(/unknown public tables/);
    expect(() => assertDemoDatabasePreflight({ tableNames: ["sync_state"], marker: undefined, nonDemoRowCounts: {}, users: [] })).toThrow(/not owned/);
    expect(assertDemoDatabasePreflight({
      tableNames: ["sync_state", "transactions", "user"],
      marker: "koban_demo_seed_v1:seeding",
      nonDemoRowCounts: { transactions: 0 },
      users: [{ id: "demo_user_koban", email: "demo@koban.finance" }]
    })).toBe("owned");
  });
});
