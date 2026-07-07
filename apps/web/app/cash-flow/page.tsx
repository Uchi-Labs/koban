import { CashflowView, type CashflowCategoryMeta } from "@/components/cashflow-view";
import type { CashflowTxn } from "@/lib/cashflow";
import { filterTransactionsForIncludedAccounts, getFinanceData } from "@/lib/finance-data";

export default async function CashFlowPage() {
  const { accounts, categories, dashboardSummary, transactions } = await getFinanceData();
  const metricTransactions = filterTransactionsForIncludedAccounts(accounts, transactions);

  const cashflowTransactions: CashflowTxn[] = [];
  for (const transaction of metricTransactions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) {
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

  const reference =
    cashflowTransactions.map((transaction) => transaction.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);

  return (
    <CashflowView
      categories={categoryMeta}
      currency={dashboardSummary.currency}
      reference={reference}
      transactions={cashflowTransactions}
    />
  );
}
