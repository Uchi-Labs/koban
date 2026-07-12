import type { Transaction } from "@ai-finances/schema";
import type { NetWorthRange, NetWorthRangeTrend } from "@/components/dashboard-net-worth-card";

// Shared with the dashboard's net-worth hero (app/page.tsx), which computes an
// identical set of ranges inline. Kept as a separate copy here rather than a
// cross-import so this wave never touches the already-shipped dashboard file --
// both read the same `transactions` shape and produce the same six ranges.

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const dateLabelFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

/** Build 1W/1M/3M/YTD/1Y/ALL net-worth trend series purely from already-loaded transactions. */
export function buildNetWorthRangeTrends(
  currentNetWorth: number,
  transactions: Transaction[]
): NetWorthRangeTrend[] {
  const latestDate = getLatestTransactionDate(transactions);
  const latestMonth = latestDate.slice(0, 7);
  const latestYear = Number.parseInt(latestDate.slice(0, 4), 10);
  const earliestMonth = transactions.map((transaction) => transaction.date.slice(0, 7)).sort()[0] ?? latestMonth;
  const ytdMonthCount = monthDifference(`${latestYear}-01`, latestMonth) + 1;

  return [
    {
      label: "1W",
      points: createDailyNetWorthTrend(currentNetWorth, transactions, latestDate, 7)
    },
    {
      label: "1M",
      points: createDailyNetWorthTrend(currentNetWorth, transactions, latestDate, 30)
    },
    {
      label: "3M",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getRecentMonthKeys(transactions, 3))
    },
    {
      label: "YTD",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getRecentMonthKeys(transactions, ytdMonthCount))
    },
    {
      label: "1Y",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getRecentMonthKeys(transactions, 12))
    },
    {
      label: "ALL",
      points: createMonthlyNetWorthTrend(currentNetWorth, transactions, getMonthRange(earliestMonth, latestMonth))
    }
  ] satisfies Array<{ label: NetWorthRange; points: Array<{ label: string; value: number }> }>;
}

/** Percent change from the first to the last point of a trend series, "+0.00%" formatted. */
export function netWorthTrendPercent(points: Array<{ value: number }>): string {
  const first = points[0]?.value ?? 0;
  const last = points.at(-1)?.value ?? first;

  if (first === 0) {
    return "0.00%";
  }

  const percent = ((last - first) / Math.abs(first)) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function createDailyNetWorthTrend(
  currentNetWorth: number,
  transactions: Transaction[],
  latestDate: string,
  dayCount: number
) {
  const keys = getRecentDateKeys(latestDate, dayCount);
  const keySet = new Set(keys);
  const netCashFlowByDate = new Map<string, number>();

  for (const transaction of transactions) {
    if (keySet.has(transaction.date)) {
      netCashFlowByDate.set(transaction.date, roundMoney((netCashFlowByDate.get(transaction.date) ?? 0) + transaction.amount));
    }
  }

  return createBackwardNetWorthPoints(currentNetWorth, keys, netCashFlowByDate, formatDateLabel);
}

function createMonthlyNetWorthTrend(currentNetWorth: number, transactions: Transaction[], months: string[]) {
  const monthSet = new Set(months);
  const netCashFlowByMonth = new Map<string, number>();

  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    if (monthSet.has(month)) {
      netCashFlowByMonth.set(month, roundMoney((netCashFlowByMonth.get(month) ?? 0) + transaction.amount));
    }
  }

  return createBackwardNetWorthPoints(currentNetWorth, months, netCashFlowByMonth, formatMonthLabel);
}

function createBackwardNetWorthPoints(
  currentNetWorth: number,
  keys: string[],
  netCashFlowByKey: Map<string, number>,
  formatLabel: (key: string) => string
) {
  let runningNetWorth = currentNetWorth;
  const valuesByKey = new Map<string, number>();

  for (const key of [...keys].reverse()) {
    valuesByKey.set(key, roundMoney(runningNetWorth));
    runningNetWorth = roundMoney(runningNetWorth - (netCashFlowByKey.get(key) ?? 0));
  }

  return keys.map((key) => ({
    label: formatLabel(key),
    value: valuesByKey.get(key) ?? currentNetWorth
  }));
}

function getRecentMonthKeys(transactions: Transaction[], count: number) {
  const latestMonth = transactions.map((transaction) => transaction.date.slice(0, 7)).sort().at(-1) ?? new Date().toISOString().slice(0, 7);
  const [year, month] = latestMonth.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  const months: string[] = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1));
    months.push(date.toISOString().slice(0, 7));
  }

  return months;
}

function getMonthRange(startMonth: string, endMonth: string) {
  const count = monthDifference(startMonth, endMonth) + 1;
  return Array.from({ length: Math.max(1, count) }, (_, index) => addMonths(startMonth, index));
}

function monthDifference(startMonth: string, endMonth: string) {
  const [startYear, start] = startMonth.split("-").map(Number);
  const [endYear, end] = endMonth.split("-").map(Number);
  return (endYear - startYear) * 12 + (end - start);
}

function addMonths(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function getRecentDateKeys(latestDate: string, count: number) {
  return Array.from({ length: count }, (_, index) => addDays(latestDate, index - count + 1));
}

function addDays(date: string, offset: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function getLatestTransactionDate(transactions: Transaction[]) {
  return transactions.map((transaction) => transaction.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
}

function formatMonthLabel(month: string) {
  return monthLabelFormatter.format(new Date(`${month}-01T12:00:00Z`));
}

function formatDateLabel(date: string) {
  return dateLabelFormatter.format(new Date(`${date}T12:00:00Z`));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
