import type { Account, Category, DashboardSummary, RecurringItem, Transaction } from "@ai-finances/schema";
import { isReviewActionableTransaction, isSpendingTransaction } from "@/lib/transaction-classification";
import { getAccountName, getCategory } from "@/lib/view-models";

export interface ListPage<T> {
  data: T[];
  has_more: boolean;
  object: "list";
}

export type TransactionReviewFilter = "actionable" | "all" | "reviewed" | "unreviewed";

export function parseListParams(searchParams: URLSearchParams, defaultLimit = 50) {
  return {
    limit: parseBoundedLimit(searchParams.get("limit"), defaultLimit),
    startingAfter: searchParams.get("starting_after") ?? undefined
  };
}

export function parseBoundedLimit(value: unknown, defaultLimit: number, maxLimit = 250): number {
  const parsed = parseNumericLimit(value, defaultLimit);
  return Math.min(Math.max(Math.trunc(parsed), 1), maxLimit);
}

export function paginateById<T extends { id: string }>(
  rows: T[],
  {
    limit,
    startingAfter
  }: {
    limit: number;
    startingAfter?: string;
  }
): ListPage<T> {
  const startIndex = startingAfter ? rows.findIndex((row) => row.id === startingAfter) + 1 : 0;
  const safeStartIndex = startIndex > 0 ? startIndex : 0;
  const page = rows.slice(safeStartIndex, safeStartIndex + limit + 1);

  return {
    data: page.slice(0, limit),
    has_more: page.length > limit,
    object: "list"
  };
}

export function serializeAccount(account: Account) {
  return {
    object: "account",
    id: account.id,
    provider_connection_id: account.providerConnectionId,
    group_id: account.groupId,
    name: account.name,
    institution_name: account.institutionName,
    type: account.type,
    mask: account.mask,
    currency: account.currency,
    current_balance: account.currentBalance,
    available_balance: account.availableBalance,
    included_in_net_worth: account.includedInNetWorth,
    last_updated_at: account.lastUpdatedAt
  };
}

export function serializeCategory(category: Category, transactionCount = 0, spending = 0) {
  return {
    object: "category",
    id: category.id,
    name: category.name,
    parent_id: category.parentId,
    icon: category.icon,
    color: category.color,
    budget_amount: category.budgetAmount,
    sort_order: category.sortOrder,
    transaction_count: transactionCount,
    spending
  };
}

export function serializeTransaction(
  transaction: Transaction,
  {
    accounts,
    categories
  }: {
    accounts: Account[];
    categories: Category[];
  }
) {
  const category = getCategory(transaction.categoryId, categories);

  return {
    object: "transaction",
    id: transaction.id,
    account_id: transaction.accountId,
    account_name: getAccountName(transaction.accountId, accounts),
    provider_connection_id: transaction.providerConnectionId,
    date: transaction.date,
    authorized_date: transaction.authorizedDate,
    posted_date: transaction.postedDate,
    merchant_name: transaction.merchantName,
    description: transaction.description,
    amount: transaction.amount,
    currency: transaction.currency,
    category_id: transaction.categoryId,
    category,
    status: transaction.status,
    reviewed: transaction.reviewed,
    needs_review: isReviewActionableTransaction(transaction),
    tags: transaction.tags,
    notes: transaction.notes,
    pending_transaction_id: transaction.pendingTransactionId
  };
}

export function serializeRecurring(
  item: RecurringItem,
  {
    accounts,
    categories
  }: {
    accounts: Account[];
    categories: Category[];
  }
) {
  return {
    object: "recurring",
    id: item.id,
    name: item.name,
    category_id: item.categoryId,
    category: getCategory(item.categoryId, categories),
    account_id: item.accountId,
    account_name: item.accountId ? getAccountName(item.accountId, accounts) : undefined,
    cadence: item.cadence,
    amount: item.amount,
    average_amount: item.averageAmount,
    currency: item.currency,
    next_date: item.nextDate,
    last_charged_at: item.lastChargedAt,
    status: item.status
  };
}

export function serializeDashboardSummary(summary: DashboardSummary) {
  return {
    object: "dashboard_summary",
    as_of: summary.asOf,
    currency: summary.currency,
    net_worth: summary.netWorth,
    cash_balance: summary.cashBalance,
    credit_balance: summary.creditBalance,
    monthly_income: summary.monthlyIncome,
    monthly_spending: summary.monthlySpending,
    transactions_to_review: summary.transactionsToReview,
    pending_transaction_count: summary.pendingTransactionCount,
    top_categories: summary.topCategories.map((category) => ({
      category_id: category.categoryId,
      amount: category.amount,
      transaction_count: category.transactionCount,
      budget_amount: category.budgetAmount
    })),
    upcoming_recurring_ids: summary.upcomingRecurringIds,
    provider_connection_ids: summary.providerConnectionIds
  };
}

export function transactionMatchesQuery(transaction: Transaction, query: string): boolean {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return [
    transaction.merchantName,
    transaction.description,
    transaction.notes ?? "",
    transaction.categoryId,
    ...transaction.tags
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function parseTransactionReviewFilter({
  review,
  reviewed
}: {
  review: string | null;
  reviewed: string | null;
}): TransactionReviewFilter {
  const normalizedReview = normalizeReviewFilterValue(review);

  if (normalizedReview === "actionable" || normalizedReview === "needs_review") {
    return "actionable";
  }

  if (normalizedReview === "reviewed") {
    return "reviewed";
  }

  if (normalizedReview === "unreviewed") {
    return "unreviewed";
  }

  if (reviewed === "true") {
    return "reviewed";
  }

  if (reviewed === "false") {
    return "unreviewed";
  }

  return "all";
}

export function transactionMatchesReviewFilter(transaction: Transaction, reviewFilter: TransactionReviewFilter): boolean {
  switch (reviewFilter) {
    case "actionable":
      return isReviewActionableTransaction(transaction);
    case "reviewed":
      return transaction.reviewed;
    case "unreviewed":
      return !transaction.reviewed;
    case "all":
      return true;
  }
}

export function categoryRollups(categories: Category[], transactions: Transaction[]) {
  return categories.map((category) => {
    const categoryTransactions = transactions.filter((transaction) => transaction.categoryId === category.id);
    const spending = categoryTransactions
      .filter(isSpendingTransaction)
      .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);

    return {
      category,
      spending: roundMoney(spending),
      transactionCount: categoryTransactions.length
    };
  });
}

function parseNumericLimit(value: unknown, defaultLimit: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : defaultLimit;
  }

  if (typeof value !== "string" || !value.trim()) {
    return defaultLimit;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultLimit;
}

function normalizeReviewFilterValue(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
