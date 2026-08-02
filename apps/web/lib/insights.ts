import type { Category, Transaction } from "@ai-finances/schema";
import { isSpendingTransaction } from "@/lib/transaction-classification";

export type InsightKind = "budget-trajectory" | "category-delta" | "new-recurring" | "unusual-charge";
export type InsightTone = "negative" | "positive" | "warning";

export interface FinanceInsight {
  amount?: number;
  categoryId?: string;
  detail: string;
  id: string;
  kind: InsightKind;
  merchant?: string;
  title: string;
  tone: InsightTone;
}

export function deriveInsights(transactions: Transaction[], categories: Category[]): FinanceInsight[] {
  const spending = transactions.filter(isSpendingTransaction);
  // Single max scan instead of copy-and-sort: the anchor is just the latest date.
  let anchor: string | undefined;
  for (const transaction of spending) {
    if (anchor === undefined || transaction.date > anchor) anchor = transaction.date;
  }
  if (!anchor) return [];

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return [
    ...detectWeekOverWeekDeltas(spending, categoryById, anchor),
    ...detectUnusualCharges(spending, categoryById, anchor),
    ...detectNewRecurringMerchants(spending, anchor),
    ...detectBudgetTrajectory(spending, categories, anchor)
  ];
}

export function detectWeekOverWeekDeltas(
  transactions: Transaction[],
  categoryById: ReadonlyMap<string, Category>,
  anchor: string
): FinanceInsight[] {
  const anchorMs = dayMs(anchor);
  const totals = new Map<string, { current: number; previous: number }>();
  for (const transaction of transactions) {
    const age = Math.floor((anchorMs - dayMs(transaction.date)) / 86_400_000);
    if (age < 0 || age > 13) continue;
    const row = totals.get(transaction.categoryId) ?? { current: 0, previous: 0 };
    row[age <= 6 ? "current" : "previous"] += Math.abs(transaction.amount);
    totals.set(transaction.categoryId, row);
  }

  return Array.from(totals.entries()).flatMap(([categoryId, values]) => {
    const delta = roundMoney(values.current - values.previous);
    const baseline = Math.max(values.previous, 1);
    if (Math.abs(delta) <= 25 || Math.abs(delta) / baseline <= 0.3) return [];
    const category = categoryById.get(categoryId);
    const name = category?.name ?? "Spending";
    const up = delta > 0;
    return [{
      amount: Math.abs(delta),
      categoryId,
      detail: `${name} was ${money(Math.abs(delta))} ${up ? "higher" : "lower"} than the previous seven days.`,
      id: insightId("category-delta", categoryId, anchor, String(Math.round(delta * 100))),
      kind: "category-delta" as const,
      title: `${name} ${up ? "increased" : "decreased"} this week`,
      tone: up ? "negative" as const : "positive" as const
    }];
  });
}

export function detectUnusualCharges(
  transactions: Transaction[],
  categoryById: ReadonlyMap<string, Category>,
  anchor: string
): FinanceInsight[] {
  const anchorMs = dayMs(anchor);

  // Merchant and category histories are grouped once up front. The previous
  // shape re-scanned every transaction (and re-ran normalize() on each) for
  // every candidate in the 30-day window, which is O(candidates x total) regex
  // work -- ~3M normalize() calls on a 10k-transaction ledger. Grouping is
  // O(total) and each candidate then does O(1) lookups against pre-sorted
  // amounts, with the candidate's own row excluded by index (see excluding()).
  const merchantGroups = groupAmounts(transactions, (row) => normalize(row.merchantName));
  const categoryGroups = groupAmounts(transactions, (row) => row.categoryId);

  const candidates = transactions.filter((transaction) => {
    const age = Math.floor((anchorMs - dayMs(transaction.date)) / 86_400_000);
    return age >= 0 && age <= 30;
  });
  candidates.sort((a, b) => b.date.localeCompare(a.date));

  return candidates.flatMap((transaction) => {
    const amount = Math.abs(transaction.amount);
    const merchantHistory = excluding(merchantGroups.get(normalize(transaction.merchantName)), transaction.id);
    const categoryHistory = excluding(categoryGroups.get(transaction.categoryId), transaction.id);
    const merchantUnusual = merchantHistory.size >= 3 && amount > merchantHistory.percentile(0.95);
    const medianAmount = categoryHistory.median();
    const categoryUnusual = categoryHistory.size >= 3 && medianAmount > 0 && amount > medianAmount * 3;
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

export function detectNewRecurringMerchants(transactions: Transaction[], anchor: string): FinanceInsight[] {
  const byMerchant = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const key = normalize(transaction.merchantName);
    if (!key) continue;
    const rows = byMerchant.get(key) ?? [];
    rows.push(transaction);
    byMerchant.set(key, rows);
  }

  return Array.from(byMerchant.values()).flatMap((rows) => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 3) return [];
    const recent = sorted.slice(-3);
    const gaps = [daysBetween(recent[0]!.date, recent[1]!.date), daysBetween(recent[1]!.date, recent[2]!.date)];
    const firstAge = daysBetween(sorted[0]!.date, anchor);
    const latestAge = daysBetween(recent[2]!.date, anchor);
    if (!gaps.every((gap) => gap >= 20 && gap <= 40) || firstAge > 120 || latestAge > 45) return [];
    const latest = recent[2]!;
    return [{
      amount: Math.abs(latest.amount),
      categoryId: latest.categoryId,
      detail: `Three monthly-looking charges were detected, most recently ${money(Math.abs(latest.amount))}.`,
      id: insightId("new-recurring", normalize(latest.merchantName), latest.date),
      kind: "new-recurring" as const,
      merchant: latest.merchantName,
      title: `New recurring charge from ${latest.merchantName}`,
      tone: "warning" as const
    }];
  });
}

export function detectBudgetTrajectory(transactions: Transaction[], categories: Category[], anchor: string): FinanceInsight[] {
  const month = anchor.slice(0, 7);
  const day = Number(anchor.slice(8, 10));
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.date.slice(0, 7) !== month) continue;
    totals.set(transaction.categoryId, (totals.get(transaction.categoryId) ?? 0) + Math.abs(transaction.amount));
  }

  return categories.flatMap((category) => {
    if (!category.budgetAmount || category.archived) return [];
    const spent = totals.get(category.id) ?? 0;
    const projected = roundMoney((spent / Math.max(1, day)) * daysInMonth);
    const overage = roundMoney(projected - category.budgetAmount);
    if (overage <= 25) return [];
    return [{
      amount: overage,
      categoryId: category.id,
      detail: `${category.name} is on pace for ${money(projected)}, about ${money(overage)} over its monthly budget.`,
      id: insightId("budget-trajectory", category.id, month),
      kind: "budget-trajectory" as const,
      title: `${category.name} may exceed its budget`,
      tone: "negative" as const
    }];
  });
}

/** Absolute amounts for one grouping key, sorted ascending, indexed by row id. */
interface AmountGroup {
  amounts: number[];
  indexById: Map<string, number>;
}

/** One pass over the ledger; the key function runs once per row, not once per row per candidate. */
function groupAmounts(transactions: Transaction[], keyOf: (row: Transaction) => string): Map<string, AmountGroup> {
  const buckets = new Map<string, { amount: number; id: string }[]>();
  for (const row of transactions) {
    const key = keyOf(row);
    const bucket = buckets.get(key);
    const entry = { amount: Math.abs(row.amount), id: row.id };
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const groups = new Map<string, AmountGroup>();
  for (const [key, bucket] of buckets) {
    bucket.sort((left, right) => left.amount - right.amount);
    const indexById = new Map<string, number>();
    const amounts = new Array<number>(bucket.length);
    for (let index = 0; index < bucket.length; index += 1) {
      const entry = bucket[index]!;
      amounts[index] = entry.amount;
      indexById.set(entry.id, index);
    }
    groups.set(key, { amounts, indexById });
  }
  return groups;
}

/**
 * A read-only view of a group with one row (the candidate itself) removed, without
 * copying the array: reads at or past the hole shift by one. Percentile and median
 * use the same index arithmetic as the array-copying versions they replaced.
 */
function excluding(group: AmountGroup | undefined, excludedId: string) {
  const amounts = group?.amounts ?? [];
  const hole = group?.indexById.get(excludedId) ?? -1;
  const size = hole >= 0 ? amounts.length - 1 : amounts.length;
  const at = (index: number): number | undefined => amounts[hole >= 0 && index >= hole ? index + 1 : index];

  return {
    median(): number {
      if (size === 0) return 0;
      const middle = Math.floor(size / 2);
      return size % 2 === 0 ? ((at(middle - 1) ?? 0) + (at(middle) ?? 0)) / 2 : at(middle) ?? 0;
    },
    percentile(quantile: number): number {
      return at(Math.max(0, Math.ceil(quantile * size) - 1)) ?? 0;
    },
    size
  };
}

function dayMs(date: string): number { return Date.parse(`${date}T12:00:00Z`); }
function daysBetween(left: string, right: string): number { return Math.round((dayMs(right) - dayMs(left)) / 86_400_000); }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim(); }
function money(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function roundMoney(value: number): number { return Math.round(value * 100) / 100; }
function insightId(...parts: string[]): string { return parts.map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")).join(":"); }
