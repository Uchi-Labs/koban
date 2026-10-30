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

  it("judges a merchant with steady history against itself, not its category", () => {
    const groceries = [txn("g1", "2026-06-01", -20), txn("g2", "2026-06-08", -25), txn("g3", "2026-06-15", -30)];
    const warehouse = ["2026-04-12", "2026-05-10", "2026-06-14", "2026-07-12"].map((date, index) => ({
      ...txn(`w${index}`, date, -[200, 205, 190, 198][index]!),
      merchantName: "Warehouse Club"
    }));
    expect(detectUnusualCharges([...groceries, ...warehouse], categories, "2026-07-13")).toEqual([]);

    const firstVisit = { ...txn("new", "2026-07-12", -240), merchantName: "New Bistro" };
    expect(detectUnusualCharges([...groceries, firstVisit], categories, "2026-07-13")[0]).toMatchObject({ merchant: "New Bistro" });
  });

  it("detects a new monthly-looking merchant", () => {
    const rows = [txn("a", "2026-05-13", -12), txn("b", "2026-06-13", -12), txn("c", "2026-07-13", -12)];
    expect(detectNewRecurringMerchants(rows, "2026-07-13")[0]).toMatchObject({ kind: "new-recurring" });
  });

  it("projects a category over its monthly budget", () => {
    expect(detectBudgetTrajectory([txn("a", "2026-07-10", -200)], [food], "2026-07-10")[0]).toMatchObject({ kind: "budget-trajectory", tone: "negative" });
  });

  it("counts a bill seen in each of the last two months once instead of projecting it", () => {
    const housing: Category = { ...food, budgetAmount: 1_500, id: "cat_housing", name: "Housing" };
    const mortgage = ["2026-05-01", "2026-06-01", "2026-07-01"].map((date, index) => ({
      ...txn(`m${index}`, date, -1_465),
      categoryId: "cat_housing",
      merchantName: "Mortgage"
    }));
    expect(detectBudgetTrajectory(mortgage, [housing], "2026-07-03")).toEqual([]);

    const firstMonth = [{ ...mortgage[2]!, id: "only" }];
    expect(detectBudgetTrajectory(firstMonth, [housing], "2026-07-03")[0]).toMatchObject({ kind: "budget-trajectory" });
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

  // detectUnusualCharges was rewritten from "rescan every transaction for every
  // candidate" to "group once, then index into the group". This pins the fast
  // version to the exact output of the original nested-scan algorithm, which is
  // reproduced below as referenceDetectUnusualCharges.
  it("matches the reference nested-scan algorithm on generated ledgers", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rows = generateLedger(seed, 160);
      const anchor = rows.map((row) => row.date).sort().at(-1)!;
      const lookup = new Map(generatedCategories.map((category) => [category.id, category]));
      expect(detectUnusualCharges(rows, lookup, anchor)).toEqual(
        referenceDetectUnusualCharges(rows, lookup, anchor)
      );
    }
  });

  it("matches the reference algorithm when merchants and categories collide", () => {
    // Every row shares one merchant and one category, so the self-exclusion
    // index arithmetic operates on a single large group.
    const rows = Array.from({ length: 90 }, (_, index) =>
      txn(`t${index}`, `2026-0${1 + (index % 7)}-${String(1 + (index % 28)).padStart(2, "0")}`, -(index % 11) - 1)
    );
    const anchor = rows.map((row) => row.date).sort().at(-1)!;
    expect(detectUnusualCharges(rows, categories, anchor)).toEqual(
      referenceDetectUnusualCharges(rows, categories, anchor)
    );
  });
});

const generatedCategories: Category[] = [
  food,
  { archived: false, budgetAmount: 120, color: "#0af", emoji: "🚕", icon: "circle", id: "cat_travel", name: "Travel", sortOrder: 20 },
  { archived: false, budgetAmount: 80, color: "#af0", emoji: "🛒", icon: "circle", id: "cat_shop", name: "Shopping", sortOrder: 30 }
];

/** Deterministic pseudo-random ledger; no Math.random so failures reproduce. */
function generateLedger(seed: number, count: number): Transaction[] {
  let state = seed * 7919;
  const next = (bound: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % bound;
  };
  const merchants = ["Cafe Roma", "cafe  roma!", "Transit Co", "", "Grocer"];
  return Array.from({ length: count }, (_, index) => ({
    ...txn(`gen${index}`, `2026-${String(1 + next(7)).padStart(2, "0")}-${String(1 + next(28)).padStart(2, "0")}`, -(1 + next(500))),
    categoryId: generatedCategories[next(generatedCategories.length)]!.id,
    merchantName: merchants[next(merchants.length)]!
  }));
}

/** Verbatim pre-optimization implementation, kept only as the test oracle. */
function referenceDetectUnusualCharges(
  transactions: Transaction[],
  categoryById: ReadonlyMap<string, Category>,
  anchor: string
) {
  const dayMs = (date: string) => Date.parse(`${date}T12:00:00Z`);
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  const insightId = (...parts: string[]) =>
    parts.map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")).join(":");
  const percentile = (values: number[], quantile: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? 0;
  };
  const median = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
  };

  const anchorMs = dayMs(anchor);
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.flatMap((transaction) => {
    const age = Math.floor((anchorMs - dayMs(transaction.date)) / 86_400_000);
    if (age < 0 || age > 30) return [];
    const amount = Math.abs(transaction.amount);
    const merchantHistory = transactions
      .filter((row) => row.id !== transaction.id && normalize(row.merchantName) === normalize(transaction.merchantName))
      .map((row) => Math.abs(row.amount));
    const categoryHistory = transactions
      .filter((row) => row.id !== transaction.id && row.categoryId === transaction.categoryId)
      .map((row) => Math.abs(row.amount));
    const merchantUnusual = merchantHistory.length >= 3 && amount > percentile(merchantHistory, 0.95);
    const medianAmount = median(categoryHistory);
    const categoryUnusual = merchantHistory.length < 3 && categoryHistory.length >= 3 && medianAmount > 0 && amount > medianAmount * 3;
    if (!merchantUnusual && !categoryUnusual) return [];
    const categoryName = categoryById.get(transaction.categoryId)?.name ?? "its category";
    return [{
      amount,
      categoryId: transaction.categoryId,
      detail: `${money(amount)} at ${transaction.merchantName} is high compared with ${merchantUnusual ? "this merchant's history" : categoryName}.`,
      id: insightId("unusual-charge", transaction.id),
      kind: "unusual-charge" as const,
      merchant: transaction.merchantName,
      title: `Unusual charge at ${transaction.merchantName}`,
      tone: "warning" as const
    }];
  }).slice(0, 5);
}

function txn(id: string, date: string, amount: number): Transaction {
  return { accountId: "acct", amount, categoryId: "cat_food", currency: "USD", date, description: "Purchase", id, merchantName: "Merchant", postedDate: date, providerConnectionId: "provider", reviewed: false, status: "posted", tags: [] };
}
