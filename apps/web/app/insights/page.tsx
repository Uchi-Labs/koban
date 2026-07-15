import { InsightsFeed } from "@/components/insights-feed";
import { SpendingHeatmap } from "@/components/spending-heatmap";
import { applyBudgetOverrides, getCategoryBudgetOverrides } from "@/lib/category-budgets";
import { getFinanceData } from "@/lib/finance-data";
import { getDismissedInsightIds } from "@/lib/insight-dismissals";
import { deriveInsights } from "@/lib/insights";
import { buildSpendingHeatmapData } from "@/lib/spending-heatmap";

export default async function InsightsPage() {
  const [{ categories: rawCategories, dashboardSummary, transactions }, overrides, dismissed] = await Promise.all([
    getFinanceData(),
    getCategoryBudgetOverrides(),
    getDismissedInsightIds()
  ]);
  const insights = deriveInsights(transactions, applyBudgetOverrides(rawCategories, overrides)).filter((item) => !dismissed.has(item.id));
  const heatmap = buildSpendingHeatmapData(transactions, dashboardSummary.currency);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 md:px-6" data-testid="insights-page">
      <header className="mb-5">
        <h1 className="app-page-title">Insights</h1>
        <p className="app-page-description mt-1.5">Deterministic signals from your transactions, recurring activity, and budgets.</p>
      </header>
      <div className="grid gap-5">
        {heatmap.length > 0 ? <SpendingHeatmap currency={dashboardSummary.currency} data={heatmap} /> : null}
        <InsightsFeed initialInsights={insights} />
      </div>
    </main>
  );
}
