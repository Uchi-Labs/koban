import { InsightsFeed } from "@/components/insights-feed";
import { applyBudgetOverrides, getCategoryBudgetOverrides } from "@/lib/category-budgets";
import { getFinanceData } from "@/lib/finance-data";
import { getDismissedInsightIds } from "@/lib/insight-dismissals";
import { deriveInsights } from "@/lib/insights";

export default async function InsightsPage() {
  const [{ categories: rawCategories, transactions }, overrides, dismissed] = await Promise.all([
    getFinanceData(),
    getCategoryBudgetOverrides(),
    getDismissedInsightIds()
  ]);
  const insights = deriveInsights(transactions, applyBudgetOverrides(rawCategories, overrides)).filter((item) => !dismissed.has(item.id));
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 md:px-6" data-testid="insights-page">
      <header className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">Deterministic signals from your transactions, recurring activity, and budgets.</p>
      </header>
      <InsightsFeed initialInsights={insights} />
    </main>
  );
}
