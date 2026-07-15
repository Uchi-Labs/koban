import type { Category, Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { detectBudgetTrajectory, detectNewRecurringMerchants, detectUnusualCharges, detectWeekOverWeekDeltas } from "@/lib/insights";
import { buildSpendingHeatmapData } from "@/lib/spending-heatmap";

const food: Category = { archived: false, budgetAmount: 300, color: "#f90", emoji: "🍽️", icon: "circle", id: "cat_food", name: "Food", sortOrder: 10 };
const categories = new Map([[food.id, food]]);

describe("finance insights", () => {
  it("detects meaningful week over week category changes", () => {
    const rows = [txn("now", "2026-07-13", -120), txn("previous", "2026-07-06", -40)];
    expect(detectWeekOverWeekDeltas(rows, categories, "2026-07-13")[0]).toMatchObject({ amount: 80, kind: "category-delta", tone: "negative" });
  });

  it("detects an unusual charge against category history", () => {
    const rows = [txn("large", "2026-07-13", -400), txn("a", "2026-06-01", -20), txn("b", "2026-06-02", -25), txn("c", "2026-06-03", -30)];
    expect(detectUnusualCharges(rows, categories, "2026-07-13")[0]).toMatchObject({ kind: "unusual-charge", merchant: "Merchant" });
  });

  it("detects a new monthly-looking merchant", () => {
    const rows = [txn("a", "2026-05-13", -12), txn("b", "2026-06-13", -12), txn("c", "2026-07-13", -12)];
    expect(detectNewRecurringMerchants(rows, "2026-07-13")[0]).toMatchObject({ kind: "new-recurring" });
  });

  it("projects a category over its monthly budget", () => {
    expect(detectBudgetTrajectory([txn("a", "2026-07-10", -200)], [food], "2026-07-10")[0]).toMatchObject({ kind: "budget-trajectory", tone: "negative" });
  });

  it("builds daily spending quantiles while excluding transfers and inflows", () => {
    const transfer = { ...txn("transfer", "2026-07-13", -999), categoryId: "cat_transfer" };
    const income = { ...txn("income", "2026-07-13", 500), categoryId: "cat_income" };
    const data = buildSpendingHeatmapData([
      txn("small", "2026-07-10", -10),
      txn("medium", "2026-07-11", -20),
      txn("large", "2026-07-12", -30),
      txn("largest", "2026-07-13", -40),
      transfer,
      income
    ]);

    expect(data).toHaveLength(365);
    expect(data.slice(-4).map(({ count, date, level, spend }) => ({ count, date, level, spend }))).toEqual([
      { count: 1, date: "2026-07-10", level: 1, spend: 10 },
      { count: 1, date: "2026-07-11", level: 2, spend: 20 },
      { count: 1, date: "2026-07-12", level: 3, spend: 30 },
      { count: 1, date: "2026-07-13", level: 4, spend: 40 }
    ]);
  });
});

function txn(id: string, date: string, amount: number): Transaction {
  return { accountId: "acct", amount, categoryId: "cat_food", currency: "USD", date, description: "Purchase", id, merchantName: "Merchant", postedDate: date, providerConnectionId: "provider", reviewed: false, status: "posted", tags: [] };
}
