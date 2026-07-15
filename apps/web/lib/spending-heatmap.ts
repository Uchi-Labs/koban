import type { Transaction } from "@ai-finances/schema";
import type { Activity } from "@/components/ui/contribution-graph";
import { isSpendingTransaction } from "@/lib/transaction-classification";

export interface SpendingHeatmapActivity extends Activity {
  spend: number;
}

export function buildSpendingHeatmapData(
  transactions: Transaction[],
  currency = "USD"
): SpendingHeatmapActivity[] {
  const spending = transactions.filter(isSpendingTransaction);
  const anchor = spending.map((transaction) => transaction.date).sort().at(-1);
  if (!anchor) return [];

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
