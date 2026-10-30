import { DashboardView } from "@/components/dashboard-view";
import { buildTopCategoryCells } from "@/lib/dashboard-top-categories";
import { createMonthlySpendingProjection } from "@/lib/finance-projection";
import { getFinanceData } from "@/lib/finance-data";
import { applyBudgetOverrides, getCategoryBudgetOverrides } from "@/lib/category-budgets";
import { getDismissedInsightIds } from "@/lib/insight-dismissals";
import { deriveInsights } from "@/lib/insights";
import { buildDashboardTrends } from "@/lib/net-worth-trend";
import { isReviewActionableTransaction } from "@/lib/transaction-classification";
import { getTransactionViews, getUpcomingRecurringViews } from "@/lib/view-models";

export default async function DashboardPage() {
  const [financeData, budgetOverrides, dismissedInsights] = await Promise.all([
    getFinanceData(),
    getCategoryBudgetOverrides(),
    getDismissedInsightIds()
  ]);
  const {
    accountGroups,
    accounts,
    categories,
    dashboardSummary,
    recurringItems,
    source,
    transactions
  } = financeData;
  const insights = deriveInsights(transactions, applyBudgetOverrides(categories, budgetOverrides)).filter((item) => !dismissedInsights.has(item.id));
  const reviewRows = getTransactionViews(
    transactions.filter(isReviewActionableTransaction).slice(0, 10),
    { accounts, categories }
  );
  const recurringViews = getUpcomingRecurringViews(recurringItems, categories);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const monthlyBudget = categories.reduce((total, category) => total + (category.budgetAmount ?? 0), 0);
  const monthlySpending = Math.abs(dashboardSummary.monthlySpending);
  const monthlyBudgetDelta = monthlySpending - monthlyBudget;
  const { latestTransactionDate, netWorthTrends, spendingTrend } = buildDashboardTrends(
    dashboardSummary.netWorth,
    transactions
  );
  const monthlySpendingProjection = createMonthlySpendingProjection({
    latestDate: latestTransactionDate,
    monthlySpending,
    transactions
  });
  const projectedMonthlySpending = monthlySpendingProjection.amount;
  const reviewSectionLabel = reviewRows[0]?.dateLabel ?? "Latest";
  const investmentBalance = accountGroups.find((group) => group.id === "group_investments")?.totalBalance ?? 0;
  const topCategoryCells = buildTopCategoryCells(dashboardSummary.topCategories, categories);

  const overBudget = monthlyBudgetDelta >= 0;
  const projectionIsEarly = monthlySpendingProjection.confidence === "early";
  const projectedOverBudget = !projectionIsEarly && projectedMonthlySpending > monthlyBudget && monthlyBudget > 0;

  return (
    <DashboardView
      accountGroups={accountGroups}
      accounts={accounts}
      categoryById={categoryById}
      dashboardSummary={dashboardSummary}
      insights={insights}
      investmentBalance={investmentBalance}
      monthlyBudget={monthlyBudget}
      monthlyBudgetDelta={monthlyBudgetDelta}
      monthlySpending={monthlySpending}
      netWorthTrends={netWorthTrends}
      overBudget={overBudget}
      projectedMonthlySpending={projectedMonthlySpending}
      projectedOverBudget={projectedOverBudget}
      projectionIsEarly={projectionIsEarly}
      recurringViews={recurringViews}
      reviewRows={reviewRows}
      reviewSectionLabel={reviewSectionLabel}
      source={source}
      spendingTrend={spendingTrend}
      topCategoryCells={topCategoryCells}
    />
  );
}
