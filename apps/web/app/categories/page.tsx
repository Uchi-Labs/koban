import type { Category, Transaction } from "@ai-finances/schema";
import { CategoryWorkbench, type CategoryDetail, type CategorySummary } from "@/components/category-workbench";
import { applyBudgetOverrides, getCategoryBudgetOverrides } from "@/lib/category-budgets";
import { getEffectiveLlmEnrichmentStatus } from "@/lib/enrichment-runs";
import { filterTransactionsForIncludedAccounts, getFinanceData } from "@/lib/finance-data";
import { isSpendingTransaction } from "@/lib/transaction-classification";
import { getCategory } from "@/lib/view-models";

const TIMELINE_MONTHS = 24;

export default async function CategoriesPage() {
  const [{ accounts, categories: rawCategories, dashboardSummary, transactions }, aiProvider, budgetOverrides] =
    await Promise.all([getFinanceData(), getEffectiveLlmEnrichmentStatus(), getCategoryBudgetOverrides()]);

  const categories = applyBudgetOverrides(rawCategories, budgetOverrides);
  const metricTransactions = filterTransactionsForIncludedAccounts(accounts, transactions);
  const months = buildMonthAxis(metricTransactions);
  const latestMonth = months.at(-1) ?? new Date().toISOString().slice(0, 7);
  const monthLabel = formatMonthLabel(latestMonth);
  const transactionsByCategoryId = groupTransactionsByCategoryId(metricTransactions);

  const details: CategoryDetail[] = [];
  for (const category of categories) {
    if (!category.archived) {
      details.push(buildCategoryDetail(
        category,
        categories,
        transactionsByCategoryId.get(category.id) ?? [],
        months,
        latestMonth
      ));
    }
  }
  details.sort((left, right) => right.spentThisMonth - left.spentThisMonth || right.allTimeSpending - left.allTimeSpending);

  const summaries: CategorySummary[] = details.map((detail) => ({
    allTimeSpending: detail.allTimeSpending,
    budgetAmount: detail.budgetAmount,
    color: detail.color,
    emoji: detail.emoji,
    id: detail.id,
    isBuiltIn: BUILT_IN_IDS.has(detail.id),
    latestMerchant: detail.latestMerchant,
    name: detail.name,
    spentThisMonth: detail.spentThisMonth,
    transactionCount: detail.transactionCount
  }));

  const allDetail = buildAllDetail(details, dashboardSummary.monthlySpending, months);

  const uncategorizedMerchantSet = new Set<string>();
  for (const transaction of metricTransactions) {
    if (transaction.categoryId === "cat_other" && transaction.merchantName) {
      uncategorizedMerchantSet.add(transaction.merchantName);
    }
    if (uncategorizedMerchantSet.size >= 12) {
      break;
    }
  }
  const uncategorizedMerchants = Array.from(uncategorizedMerchantSet);

  return (
    <CategoryWorkbench
      aiSuggestionEnabled={aiProvider.configured}
      aiSuggestionMessage={aiProvider.errorMessage ?? "No AI provider configured."}
      allDetail={allDetail}
      details={details}
      hasTransactions={metricTransactions.length > 0}
      monthLabel={monthLabel}
      summaries={summaries}
      transactionsToReview={dashboardSummary.transactionsToReview}
      uncategorizedMerchants={uncategorizedMerchants}
    />
  );
}

const BUILT_IN_IDS = new Set([
  "cat_income",
  "cat_housing",
  "cat_food",
  "cat_transportation",
  "cat_software",
  "cat_shopping",
  "cat_travel",
  "cat_transfer",
  "cat_other"
]);

function buildCategoryDetail(
  category: Category,
  categories: Category[],
  categoryTransactions: Transaction[],
  months: string[],
  latestMonth: string
): CategoryDetail {
  const view = getCategory(category.id, categories);
  categoryTransactions.sort((left, right) => right.date.localeCompare(left.date));
  const spendingTransactions = categoryTransactions.filter(isSpendingTransaction);
  const spendingByMonth = new Map<string, number>();
  for (const transaction of spendingTransactions) {
    const month = transaction.date.slice(0, 7);
    spendingByMonth.set(month, (spendingByMonth.get(month) ?? 0) + Math.abs(transaction.amount));
  }

  const monthlySeries = months.map((month) => ({
    month,
    spent: roundMoney(spendingByMonth.get(month) ?? 0)
  }));

  const spentThisMonth = monthlySeries.find((point) => point.month === latestMonth)?.spent ?? 0;
  const allTimeSpending = roundMoney(spendingTransactions.reduce((total, transaction) => total + Math.abs(transaction.amount), 0));

  return {
    allTimeSpending,
    budgetAmount: category.budgetAmount,
    color: view.color,
    emoji: view.emoji ?? "🏷️",
    id: category.id,
    isBuiltIn: BUILT_IN_IDS.has(category.id),
    latestMerchant: categoryTransactions[0]?.merchantName,
    monthly: monthlySeries,
    name: view.name,
    spentThisMonth,
    transactionCount: categoryTransactions.length,
    yearly: buildYearlyMetrics(spendingTransactions)
  };
}

function groupTransactionsByCategoryId(transactions: Transaction[]): Map<string, Transaction[]> {
  const transactionsByCategoryId = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const categoryTransactions = transactionsByCategoryId.get(transaction.categoryId) ?? [];
    categoryTransactions.push(transaction);
    transactionsByCategoryId.set(transaction.categoryId, categoryTransactions);
  }
  return transactionsByCategoryId;
}

function buildAllDetail(
  details: CategoryDetail[],
  monthlySpending: number,
  months: string[]
): CategoryDetail {
  const spendingDetails = details.filter((detail) => detail.id !== "cat_income" && detail.id !== "cat_transfer");

  const monthly = months.map((month, index) => ({
    month,
    spent: roundMoney(spendingDetails.reduce((total, detail) => total + (detail.monthly[index]?.spent ?? 0), 0))
  }));

  const yearlyTotals = new Map<string, number>();
  const yearlyMonths = new Map<string, Set<string>>();
  for (const point of monthly) {
    const year = point.month.slice(0, 4);
    yearlyTotals.set(year, (yearlyTotals.get(year) ?? 0) + point.spent);
    if (point.spent > 0) {
      const set = yearlyMonths.get(year) ?? new Set<string>();
      set.add(point.month);
      yearlyMonths.set(year, set);
    }
  }

  const yearly: CategoryDetail["yearly"] = [];
  for (const [year, spent] of yearlyTotals.entries()) {
    const roundedSpent = roundMoney(spent);
    if (roundedSpent <= 0) {
      continue;
    }
    const activeMonths = yearlyMonths.get(year)?.size ?? 0;
    yearly.push({
      avgMonthly: activeMonths > 0 ? roundMoney(spent / activeMonths) : 0,
      spent: roundedSpent,
      year
    });
  }
  yearly.sort((left, right) => right.year.localeCompare(left.year));

  const totalBudget = roundMoney(spendingDetails.reduce((total, detail) => total + (detail.budgetAmount ?? 0), 0));
  const spentThisMonth = roundMoney(Math.abs(monthlySpending));

  return {
    allTimeSpending: roundMoney(spendingDetails.reduce((total, detail) => total + detail.allTimeSpending, 0)),
    budgetAmount: totalBudget > 0 ? totalBudget : undefined,
    color: "var(--positive)",
    emoji: "🗂️",
    id: "__all__",
    isBuiltIn: true,
    latestMerchant: undefined,
    monthly,
    name: "All Regular Categories",
    spentThisMonth,
    transactionCount: spendingDetails.reduce((total, detail) => total + detail.transactionCount, 0),
    yearly
  };
}

function buildYearlyMetrics(transactions: Transaction[]) {
  const totals = new Map<string, number>();
  const monthsByYear = new Map<string, Set<string>>();

  for (const transaction of transactions) {
    const year = transaction.date.slice(0, 4);
    const month = transaction.date.slice(0, 7);
    totals.set(year, (totals.get(year) ?? 0) + Math.abs(transaction.amount));
    const set = monthsByYear.get(year) ?? new Set<string>();
    set.add(month);
    monthsByYear.set(year, set);
  }

  return Array.from(totals.entries())
    .map(([year, spent]) => {
      const activeMonths = monthsByYear.get(year)?.size ?? 1;
      return {
        avgMonthly: roundMoney(spent / Math.max(1, activeMonths)),
        spent: roundMoney(spent),
        year
      };
    })
    .sort((left, right) => right.year.localeCompare(left.year));
}

function buildMonthAxis(transactions: Transaction[]): string[] {
  const present = new Set(transactions.map((transaction) => transaction.date.slice(0, 7)));
  const latest = Array.from(present).sort().at(-1) ?? new Date().toISOString().slice(0, 7);
  const [year, month] = latest.split("-").map(Number);
  const axis: string[] = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1));

  for (let index = 0; index < TIMELINE_MONTHS; index += 1) {
    axis.unshift(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  return axis;
}

function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  });
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
