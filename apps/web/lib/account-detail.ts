import type { Account, Category, RecurringItem, Transaction } from "@ai-finances/schema";
import { createRecurringItems } from "@/lib/finance-data";
import { isSpendingTransaction } from "@/lib/transaction-classification";
import { getCategory } from "@/lib/view-models";

export interface AccountDetailSelectionInput {
  accounts: Account[];
  transactions: Transaction[];
}

export interface AccountDetailSelection {
  account: Account;
  recurringItems: RecurringItem[];
  transactions: Transaction[];
}

export interface AccountCategorySpending {
  periodLabel: string;
  rows: Array<{ amount: number; category: Category; percent: number }>;
}

/** Selects the account page's data without crossing the account boundary. */
export function selectAccountDetailData(
  input: AccountDetailSelectionInput,
  accountId: string
): AccountDetailSelection | null {
  const account = input.accounts.find((candidate) => candidate.id === accountId);

  if (!account) {
    return null;
  }

  const transactions = input.transactions
    .filter((transaction) => transaction.accountId === accountId)
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));

  return {
    account,
    recurringItems: createRecurringItems(transactions),
    transactions
  };
}

/** Builds the latest month with real posted spending for an account. */
export function createAccountCategorySpending(
  transactions: Transaction[],
  categories: Category[]
): AccountCategorySpending {
  const latestMonth = transactions
    .filter((transaction) => transaction.status === "posted" && isSpendingTransaction(transaction))
    .map((transaction) => transaction.date.slice(0, 7))
    .sort()
    .at(-1);

  if (!latestMonth) {
    return { periodLabel: "Latest synced month", rows: [] };
  }

  const amountByCategory = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.date.startsWith(latestMonth) && transaction.status === "posted" && isSpendingTransaction(transaction)) {
      amountByCategory.set(
        transaction.categoryId,
        (amountByCategory.get(transaction.categoryId) ?? 0) + Math.abs(transaction.amount)
      );
    }
  }

  const total = [...amountByCategory.values()].reduce((sum, amount) => sum + amount, 0);
  const rows = [...amountByCategory.entries()]
    .map(([categoryId, amount]) => ({
      amount,
      category: getCategory(categoryId, categories),
      percent: total > 0 ? Math.max(4, (amount / total) * 100) : 0
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 8);

  return {
    periodLabel: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      new Date(`${latestMonth}-01T12:00:00Z`)
    ),
    rows
  };
}
