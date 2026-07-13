import type { Category, DashboardTopCategory } from "@ai-finances/schema";

export interface DashboardTopCategoryCell {
  amount: number;
  budget: number;
  categoryId: string;
}

const excludedCategoryIds = new Set(["cat_income", "cat_transfer"]);

export function buildTopCategoryCells(
  topCategories: DashboardTopCategory[],
  categories: Category[]
): DashboardTopCategoryCell[] {
  const cells: DashboardTopCategoryCell[] = [];
  const includedCategoryIds = new Set<string>();

  for (const summary of topCategories) {
    if (excludedCategoryIds.has(summary.categoryId) || includedCategoryIds.has(summary.categoryId)) {
      continue;
    }

    const amount = Math.abs(summary.amount);
    cells.push({
      amount,
      budget: summary.budgetAmount ?? amount,
      categoryId: summary.categoryId
    });
    includedCategoryIds.add(summary.categoryId);
  }

  for (const category of categories) {
    const budget = category.budgetAmount ?? 0;

    if (budget <= 0 || excludedCategoryIds.has(category.id) || includedCategoryIds.has(category.id)) {
      continue;
    }

    cells.push({ amount: 0, budget, categoryId: category.id });
    includedCategoryIds.add(category.id);
  }

  return cells.slice(0, 6);
}
