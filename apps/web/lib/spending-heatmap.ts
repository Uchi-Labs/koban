import type { Transaction } from "@ai-finances/schema";
import type { Activity } from "@/components/ui/contribution-graph";
import { isSpendingTransaction } from "@/lib/transaction-classification";

export interface SpendingHeatmapActivity extends Activity {
  spend: number;
}

/** One category's own heatmap, its levels computed within its own spend
 *  distribution so the intensity is meaningful even for a small category. */
export interface CategoryHeatmap {
  color: string;
  data: SpendingHeatmapActivity[];
  id: string;
  name: string;
  total: number;
}

export function buildSpendingHeatmapData(
  transactions: Transaction[],
  currency = "USD"
): SpendingHeatmapActivity[] {
  const spending = transactions.filter(isSpendingTransaction);
  const anchor = spending.map((transaction) => transaction.date).sort().at(-1);
  if (!anchor) return [];
  return buildHeatmapSeries(spending, anchor, currency);
}

/**
 * "All spending" plus a per-category heatmap for every category with spend in
 * the window. Every series shares the same 365-day window (anchored on the
 * latest spending date across all categories) so the calendars line up when the
 * viewer switches categories to spot seasonal patterns.
 */
export function buildCategorySpendingHeatmaps(
  transactions: Transaction[],
  categories: Array<{ color: string; id: string; name: string }>,
  currency = "USD"
): { all: SpendingHeatmapActivity[]; categories: CategoryHeatmap[] } {
  const spending = transactions.filter(isSpendingTransaction);
  const anchor = spending.map((transaction) => transaction.date).sort().at(-1);
  if (!anchor) return { all: [], categories: [] };

  const all = buildHeatmapSeries(spending, anchor, currency);
  const categoryHeatmaps = categories
    .map((category) => {
      const categorySpending = spending.filter((transaction) => transaction.categoryId === category.id);
      if (categorySpending.length === 0) return null;
      const data = buildHeatmapSeries(categorySpending, anchor, currency);
      const total = data.reduce((sum, day) => sum + day.spend, 0);
      return total > 0 ? { color: category.color, data, id: category.id, name: category.name, total } : null;
    })
    .filter((category): category is CategoryHeatmap => category !== null)
    .sort((left, right) => right.total - left.total);

  return { all, categories: categoryHeatmaps };
}

/** Daily aggregation + quantile levels over the fixed 365-day window ending at `anchor`. */
function buildHeatmapSeries(spending: Transaction[], anchor: string, currency: string): SpendingHeatmapActivity[] {
  const anchorDate = new Date(`${anchor}T00:00:00Z`);
  const firstDate = new Date(anchorDate);
  firstDate.setUTCDate(anchorDate.getUTCDate() - 364);
  const firstDateKey = firstDate.toISOString().slice(0, 10);
  const daily = new Map<string, { count: number; spend: number }>();

  for (const transaction of spending) {
    if (transaction.date < firstDateKey || transaction.date > anchor) continue;
    const current = daily.get(transaction.date) ?? { count: 0, spend: 0 };
    current.count += 1;
    current.spend += Math.abs(transaction.amount);
    daily.set(transaction.date, current);
  }

  const magnitudes = Array.from(daily.values()).map((row) => row.spend).sort((a, b) => a - b);
  const thresholds = [0.25, 0.5, 0.75].map((quantile) => quantileValue(magnitudes, quantile));
  const currencyFormatter = new Intl.NumberFormat("en-US", { currency, style: "currency" });

  return Array.from({ length: 365 }, (_, index) => {
    const date = new Date(firstDate);
    date.setUTCDate(firstDate.getUTCDate() + index);
    const dateKey = date.toISOString().slice(0, 10);
    const row = daily.get(dateKey) ?? { count: 0, spend: 0 };
    const level = row.spend <= 0 ? 0 : row.spend <= thresholds[0]! ? 1 : row.spend <= thresholds[1]! ? 2 : row.spend <= thresholds[2]! ? 3 : 4;

    return {
      count: row.count,
      date: dateKey,
      label: `${currencyFormatter.format(row.spend)} across ${row.count} ${row.count === 1 ? "transaction" : "transactions"} on ${dateKey}`,
      level,
      spend: Math.round(row.spend * 100) / 100
    };
  });
}

function quantileValue(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}
