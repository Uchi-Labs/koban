import { CashflowView, type CashflowCategoryMeta } from "@/components/cashflow-view";
import type { CashflowTxn } from "@/lib/cashflow";
import { filterTransactionsForIncludedAccounts, getFinanceData } from "@/lib/finance-data";

export default async function CashFlowPage() {
  const { accounts, categories, dashboardSummary, transactions } = await getFinanceData();
  const metricTransactions = filterTransactionsForIncludedAccounts(accounts, transactions);

  const isDateKey = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);

  // The reference date drives every window CashflowView can ask for, so it has
  // to come from the whole ledger, not the windowed slice.
  let reference: string | undefined;
  for (const transaction of metricTransactions) {
    if (isDateKey(transaction.date) && (reference === undefined || transaction.date > reference)) {
      reference = transaction.date;
    }
  }
  reference ??= new Date().toISOString().slice(0, 10);

  // CashflowView never reads a transaction outside the period it is showing. The
  // widest window it can build is "year to date" or "last 12 months" compared
  // against the previous year, which reaches at most ~24 months before the
  // reference; the calendar year two years back covers that with margin. Sending
  // the full ledger instead put every transaction ever synced into the RSC
  // payload (375 KB on a three-year ledger) to render at most three years of
  // monthly bars. The newest transaction is the reference itself, so a non-empty
  // ledger can never window down to an empty one and trip the empty state.
  const earliestNeeded = `${Number(reference.slice(0, 4)) - 2}-01-01`;
  const cashflowTransactions: CashflowTxn[] = [];
  for (const transaction of metricTransactions) {
    if (!isDateKey(transaction.date) || transaction.date < earliestNeeded) {
      continue;
    }
    cashflowTransactions.push({
      amount: transaction.amount,
      categoryId: transaction.categoryId,
      date: transaction.date
    });
  }

  const categoryMeta: CashflowCategoryMeta[] = categories.map((category) => ({
    color: category.color,
    id: category.id,
    name: category.name
  }));

  return (
    <CashflowView
      categories={categoryMeta}
      currency={dashboardSummary.currency}
      reference={reference}
      transactions={cashflowTransactions}
    />
  );
}
