import type { Category, DashboardTopCategory } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { buildTopCategoryCells } from "@/lib/dashboard-top-categories";

function category(id: string, budgetAmount: number): Category {
  return {
    budgetAmount,
    color: "#22c55e",
    icon: "circle",
    id,
    name: id,
    sortOrder: 0
  };
}

function summary(categoryId: string, amount: number, budgetAmount?: number): DashboardTopCategory {
  return {
    amount,
    budgetAmount,
    categoryId,
    transactionCount: 1
  };
}

describe("buildTopCategoryCells", () => {
  it("dedupes spending and budget branches, excludes income/transfers, and caps the result at six", () => {
    const cells = buildTopCategoryCells(
      [
        summary("cat_food", -80, 100),
        summary("cat_income", 500, 500),
        summary("cat_transfer", -200, 200),
        summary("cat_food", -20, 100),
        summary("cat_rent", -400)
      ],
      [
        category("cat_food", 100),
        category("cat_income", 500),
        category("cat_transfer", 200),
        category("cat_fun", 75),
        category("cat_utilities", 125),
        category("cat_travel", 300),
        category("cat_health", 90),
        category("cat_other", 50)
      ]
    );

    expect(cells).toEqual([
      { amount: 80, budget: 100, categoryId: "cat_food" },
      { amount: 400, budget: 400, categoryId: "cat_rent" },
      { amount: 0, budget: 75, categoryId: "cat_fun" },
      { amount: 0, budget: 125, categoryId: "cat_utilities" },
      { amount: 0, budget: 300, categoryId: "cat_travel" },
      { amount: 0, budget: 90, categoryId: "cat_health" }
    ]);
  });

  it("uses the category's current budget over the one the summary captured", () => {
    const cells = buildTopCategoryCells(
      [summary("cat_custom_childcare", -1_420), summary("cat_food", -900, 1_200)],
      [category("cat_custom_childcare", 1_450), category("cat_food", 1_300)]
    );

    expect(cells).toEqual([
      { amount: 1_420, budget: 1_450, categoryId: "cat_custom_childcare" },
      { amount: 900, budget: 1_300, categoryId: "cat_food" }
    ]);
  });
});
