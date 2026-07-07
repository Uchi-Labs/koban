// Local budget overrides for categories.
//
// The built-in categories carry hardcoded monthly budgets (see lib/categories.ts),
// but the `categories` registry table has no budget column, so custom categories
// and user-edited budgets need somewhere to live. Rather than migrate the table
// (single-writer PGlite, shared with other work), budgets persist as a small JSON
// map in the existing `sync_state` KV via the already-exported read/write helpers.
// This keeps finance-db untouched while making the "optional budget" honest.

import { readSyncStateValue, writeSyncStateValue } from "@/lib/db/finance-db";

const BUDGET_OVERRIDES_KEY = "category_budget_overrides";

export type CategoryBudgetOverrides = Record<string, number>;

export async function getCategoryBudgetOverrides(): Promise<CategoryBudgetOverrides> {
  const raw = await readSyncStateValue(BUDGET_OVERRIDES_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const result: CategoryBudgetOverrides = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        result[id] = Math.round(value * 100) / 100;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function setCategoryBudgetOverride(categoryId: string, amount: number | null): Promise<void> {
  const overrides = await getCategoryBudgetOverrides();

  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    if (!(categoryId in overrides)) {
      return;
    }
    delete overrides[categoryId];
  } else {
    overrides[categoryId] = Math.round(amount * 100) / 100;
  }

  await writeSyncStateValue(BUDGET_OVERRIDES_KEY, JSON.stringify(overrides));
}

/** Merge KV budget overrides over each category's built-in budget. */
export function applyBudgetOverrides<T extends { id: string; budgetAmount?: number }>(
  categories: T[],
  overrides: CategoryBudgetOverrides
): T[] {
  return categories.map((category) =>
    category.id in overrides ? { ...category, budgetAmount: overrides[category.id] } : category
  );
}
