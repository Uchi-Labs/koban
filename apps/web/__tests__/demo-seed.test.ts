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
    expect(first.subscriptionNames).toHaveLength(10);
    expect(first.investmentPositions).toHaveLength(7);
    expect(first.goals).toHaveLength(3);
    expect(first.ledger.transactions.some((transaction) => !transaction.reviewed)).toBe(true);
    expect(new Set(first.ledger.transactions.map((transaction) => transaction.date.slice(0, 7)))).toHaveLength(24);
    expect(new Set(first.ledger.accounts.map((account) => account.type))).toEqual(new Set(["checking", "savings", "credit_card", "investment", "loan", "cash"]));
    expect(createRecurringItems(first.ledger.transactions).length).toBeGreaterThanOrEqual(10);
    expect(createRecurringItems(first.ledger.transactions).length).toBeLessThanOrEqual(20);
    expect(() => assertDemoDataset(first)).not.toThrow();
  });

  it("ends a reconciled 24-month ledger on any as-of date without future rows", () => {
    for (const asOfDate of ["2026-10-01", "2026-10-27", "2027-02-28", "2026-12-31"]) {
      const dataset = createDemoDataset(asOfDate);
      const months = new Set(dataset.ledger.transactions.map((transaction) => transaction.date.slice(0, 7)));

      expect(dataset.ledger.transactions.every((transaction) => transaction.date <= asOfDate)).toBe(true);
      expect((dataset.ledger.balanceSnapshots ?? []).every((snapshot) => snapshot.asOfDate <= asOfDate)).toBe(true);
      expect(months).toHaveLength(24);
      expect(months.has(asOfDate.slice(0, 7))).toBe(true);
      expect(dataset.ledger.lastSyncedAt?.startsWith(asOfDate)).toBe(true);
      expect(() => assertDemoDataset(dataset)).not.toThrow();
    }
    expect(() => createDemoDataset("2026-13-40")).toThrow(/YYYY-MM-DD/);
  });

  it("itemizes the grocery, warehouse and marketplace charges with lines that add up to each charge", () => {
    const dataset = createDemoDataset("2026-11-01");
    const items = dataset.receipts.sources.flatMap((source) => source.items);
    const byId = new Map(dataset.ledger.transactions.map((transaction) => [transaction.id, transaction]));
    const itemById = new Map(items.map((item) => [item.id, item]));
    expect(items.length).toBeGreaterThan(40);
    for (const link of dataset.receipts.links) {
      const lines = itemById.get(link.sourceItemId)?.lines ?? [];
      const sum = lines.reduce((total, line) => total + Math.round((line.amount ?? 0) * 100), 0);
      expect(sum).toBe(Math.round(Math.abs(byId.get(link.transactionId)!.amount) * 100));
    }
    const amazon = dataset.receipts.links.find((link) => byId.get(link.transactionId)?.merchantName === "AMZN MKTP US*2K4LQ");
    expect(amazon).toMatchObject({ confidence: 0.88, status: "suggested" });
    expect(itemById.get(amazon!.sourceItemId)?.lines?.[0].name).toMatch(/stroller wheel/i);
    expect(items.some((item) => item.lines?.some((line) => /oat milk/i.test(line.name)))).toBe(true);
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
