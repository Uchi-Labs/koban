import { InsightsFeed } from "@/components/insights-feed";
import { SpendingHeatmap } from "@/components/spending-heatmap";
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
  return (
    <main
      className="mx-auto flex h-[calc(100svh-5.5rem-env(safe-area-inset-bottom))] w-full max-w-3xl flex-col px-4 py-5 md:h-svh md:px-6 xl:max-w-5xl"
      data-testid="insights-page"
    >
      <header className="mb-5 shrink-0">
        <h1 className="app-page-title">Insights</h1>
        <p className="app-page-description mt-1.5">Deterministic signals from your transactions, recurring activity, and budgets.</p>
      </header>
      {/* minmax(0,1fr) caps the track at the container width so wide children
          (the fixed-width heatmap svg) scroll inside their own scrollers
          instead of blowing out the column and clipping every card. */}
      {/* Heatmap stays pinned; only the feed below scrolls. */}
      {heatmap.all.length > 0 ? (
        <div className="mb-5 min-w-0 shrink-0">
          <SpendingHeatmap all={heatmap.all} categories={heatmap.categories} currency={dashboardSummary.currency} />
        </div>
      ) : null}
      <div className="scroll-fade-y no-scrollbar -mx-1 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-y-auto overscroll-contain px-1 pb-2">
        <div className="xl:max-w-3xl">
          <InsightsFeed initialInsights={insights} />
        </div>
      </div>
    </main>
  );
}
