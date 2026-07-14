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
  const anchor = spending.map((transaction) => transaction.date).sort().at(-1);
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
    const categoryUnusual = categoryHistory.length >= 3 && medianAmount > 0 && amount > medianAmount * 3;
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

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

function dayMs(date: string): number { return Date.parse(`${date}T12:00:00Z`); }
function daysBetween(left: string, right: string): number { return Math.round((dayMs(right) - dayMs(left)) / 86_400_000); }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim(); }
function money(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function roundMoney(value: number): number { return Math.round(value * 100) / 100; }
function insightId(...parts: string[]): string { return parts.map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")).join(":"); }
