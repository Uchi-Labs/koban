import type { Category, Transaction } from "@ai-finances/schema";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryPill } from "@/components/category-pill";
import { formatCurrency } from "@/lib/format";
import { getFinanceData } from "@/lib/finance-data";
import { isSpendingTransaction } from "@/lib/transaction-classification";
import { getCategory } from "@/lib/view-models";

export default async function CategoriesPage() {
  const { categories, dashboardSummary, transactions } = await getFinanceData();
  const latestMonth = getLatestMonth(transactions);
  const categoryTotals = createCategoryRows(categories, transactions, latestMonth);
  const activeCategories = categoryTotals.filter((row) => row.transactionCount > 0);
  const uncategorized = transactions.filter((transaction) => transaction.categoryId === "cat_other").length;

  return (
    <main className="flex min-h-svh flex-col" data-testid="categories-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Categories</span>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        <section>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Local category map</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Category rollups</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Categories combine Teller metadata, local overrides, and accepted enrichment suggestions. Totals never mutate Teller data.
          </p>
        </section>

        <section aria-label="Category totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label={`${latestMonth} spending`} value={formatCurrency(Math.abs(dashboardSummary.monthlySpending))} />
          <MetricCard label="Active categories" value={activeCategories.length.toLocaleString()} />
          <MetricCard label="Transactions to review" value={dashboardSummary.transactionsToReview.toLocaleString()} />
          <MetricCard label="Other category count" value={uncategorized.toLocaleString()} />
        </section>

        <Card>
          <CardHeader>
            <h2 className="text-base font-medium">Spending by category</h2>
            <p className="text-sm text-muted-foreground">Sorted by current-month spend, with all-time count and latest merchant for context.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {categoryTotals.map((row) => (
              <Link
                aria-label={`View ${row.category.name} transactions`}
                className="grid grid-cols-[1.3fr_1fr] items-center gap-4 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
                href={`/transactions?category_id=${encodeURIComponent(row.category.id)}`}
                key={row.category.id}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <CategoryPill category={row.category} />
                  <span className="text-xs text-muted-foreground">{row.transactionCount.toLocaleString()} transactions</span>
                  <em className="truncate text-xs text-muted-foreground not-italic">
                    {row.latestTransaction ? `Latest: ${row.latestTransaction.merchantName}` : "No synced transactions"}
                  </em>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="font-semibold tabular-nums">{formatCurrency(row.monthlySpending)}</b>
                    <em className="text-xs text-muted-foreground not-italic">{formatCurrency(row.allTimeSpending)} all time</em>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full"
                      style={{ background: row.category.color, width: `${row.budgetPercent}%` }}
                    />
                  </div>
                  <small className="text-xs text-muted-foreground">{row.budgetLabel}</small>
                </div>
              </Link>
            ))}
            {transactions.length === 0 ? <p className="px-1 text-sm text-muted-foreground">No Teller transactions synced yet.</p> : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <strong className="text-lg font-semibold tabular-nums">{value}</strong>
      </CardContent>
    </Card>
  );
}

function createCategoryRows(categories: Category[], transactions: Transaction[], latestMonth: string) {
  return categories
    .map((category) => {
      const categoryTransactions = transactions
        .filter((transaction) => transaction.categoryId === category.id)
        .sort((left, right) => right.date.localeCompare(left.date));
      const monthlySpending = sumSpending(categoryTransactions.filter((transaction) => transaction.date.startsWith(latestMonth)));
      const allTimeSpending = sumSpending(categoryTransactions);
      const budgetAmount = category.budgetAmount ?? monthlySpending;
      const budgetRemaining = Math.max(0, budgetAmount - monthlySpending);

      return {
        allTimeSpending,
        budgetLabel: category.budgetAmount ? `${formatCurrency(budgetRemaining)} left` : "No budget",
        budgetPercent: budgetAmount > 0 ? Math.min(100, Math.round((monthlySpending / budgetAmount) * 100)) : 0,
        category: getCategory(category.id, categories),
        latestTransaction: categoryTransactions[0],
        monthlySpending,
        transactionCount: categoryTransactions.length
      };
    })
    .sort((left, right) => right.monthlySpending - left.monthlySpending || right.allTimeSpending - left.allTimeSpending);
}

function getLatestMonth(transactions: Transaction[]) {
  return transactions.map((transaction) => transaction.date.slice(0, 7)).sort().at(-1) ?? new Date().toISOString().slice(0, 7);
}

function sumSpending(transactions: Transaction[]) {
  return roundMoney(
    transactions
      .filter(isSpendingTransaction)
      .reduce((total, transaction) => total + Math.abs(transaction.amount), 0)
  );
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
