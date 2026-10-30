import { InsightsView } from "@/components/insights-view";
import { applyBudgetOverrides, getCategoryBudgetOverrides } from "@/lib/category-budgets";
import { getFinanceData } from "@/lib/finance-data";
import { getDismissedInsightIds } from "@/lib/insight-dismissals";
import { deriveInsights } from "@/lib/insights";
import { buildCategorySpendingHeatmaps } from "@/lib/spending-heatmap";

export default async function InsightsPage() {
  const [{ categories: rawCategories, dashboardSummary, transactions }, overrides, dismissed] = await Promise.all([
    getFinanceData(),
    getCategoryBudgetOverrides(),
    getDismissedInsightIds()
  ]);
  const insights = deriveInsights(transactions, applyBudgetOverrides(rawCategories, overrides)).filter((item) => !dismissed.has(item.id));
  const heatmap = buildCategorySpendingHeatmaps(transactions, rawCategories, dashboardSummary.currency);
  return <InsightsView currency={dashboardSummary.currency} heatmap={heatmap} insights={insights} />;
}
