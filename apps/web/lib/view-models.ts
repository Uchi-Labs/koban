import type { Account, Category, RecurringItem, Transaction } from "@ai-finances/schema";
import { appCategories } from "@/lib/categories";
import { categoryFallback } from "@/lib/category-style";

export type TransactionView = Transaction & {
  accountName: string;
  category: Category;
  dateLabel: string;
  merchant: string;
  needsReview: boolean;
  relativeDateLabel: string;
};

interface ViewModelContext {
  accounts?: Account[];
  categories?: Category[];
}

export function getAccountName(accountId: string, sourceAccounts: Account[] = []) {
  const accountById = new Map(sourceAccounts.map((account) => [account.id, account]));
  const account = accountById.get(accountId);
  if (!account) {
    return "Unknown account";
  }

  return account.mask ? `${account.name} ${account.mask}` : account.name;
}

export function getCategory(categoryId: string, sourceCategories: Category[] = appCategories) {
  const categoryById = new Map(sourceCategories.map((category) => [category.id, category]));

  return (
    categoryById.get(categoryId) ?? categoryFallback()
  );
}

export function getTransactionViews(source: Transaction[] = [], context: ViewModelContext = {}): TransactionView[] {
  const referenceDate = source
    .map((transaction) => transaction.date)
    .sort()
    .at(-1);

  return source.map((transaction) => ({
    ...transaction,
    accountName: getAccountName(transaction.accountId, context.accounts),
    category: getCategory(transaction.categoryId, context.categories),
    dateLabel: formatLongDate(transaction.date),
    merchant: transaction.merchantName,
    needsReview: !transaction.reviewed,
    relativeDateLabel: getRelativeDateLabel(transaction.date, referenceDate)
  }));
}

export function getUpcomingRecurringViews(source: RecurringItem[] = [], sourceCategories: Category[] = appCategories) {
  return source.map((item) => ({
    ...item,
    category: getCategory(item.categoryId, sourceCategories),
    frequency: cadenceLabel(item.cadence),
    merchant: item.name,
    nextDateLabel: formatShortDate(item.nextDate)
  }));
}

export function formatLongDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    weekday: "long",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short"
  }).format(new Date(`${date}T12:00:00`));
}

function getRelativeDateLabel(date: string, referenceDate?: string) {
  if (!referenceDate) {
    return formatLongDate(date);
  }

  const dayDifference = daysBetween(date, referenceDate);

  if (dayDifference === 0) {
    return "Latest";
  }

  if (dayDifference === 1) {
    return "Previous day";
  }

  if (dayDifference > 1 && dayDifference < 7) {
    return `${dayDifference} days before latest`;
  }

  return formatLongDate(date);
}

function daysBetween(leftDate: string, rightDate: string): number {
  const left = Date.parse(`${leftDate}T12:00:00Z`);
  const right = Date.parse(`${rightDate}T12:00:00Z`);
  return Math.round((right - left) / 86_400_000);
}

function cadenceLabel(cadence: string) {
  return cadence.charAt(0).toUpperCase() + cadence.slice(1);
}
