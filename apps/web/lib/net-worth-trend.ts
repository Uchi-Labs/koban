import type { Transaction } from "@ai-finances/schema";
import type { NetWorthRange, NetWorthRangeTrend } from "@/components/dashboard-net-worth-card";
import { isSpendingTransaction } from "@/lib/transaction-classification";

// Month ticks carry a 2-digit year in the "Aug '24" form (apostrophe, matching
// the cash-flow chart) so a multi-year axis is never ambiguous about the year —
// and the apostrophe stops "Aug 24" from reading like a day-of-month.
const monthLabelFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const dateLabelFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });

interface TransactionTrendBuckets {
  earliestMonth: string;
  latestDate: string;
  latestMonth: string;
  netCashFlowByDate: Map<string, number>;
  netCashFlowByMonth: Map<string, number>;
  spendingByMonth: Map<string, number>;
}

export interface DashboardTrends {
  latestTransactionDate: string;
  netWorthTrends: NetWorthRangeTrend[];
  spendingTrend: Array<{ label: string; spending: number }>;
}

/** Dashboard trend data from one transaction pass (plan 036-A shared extraction). */
export function buildDashboardTrends(currentNetWorth: number, transactions: Transaction[]): DashboardTrends {
  const buckets = bucketTransactionTrends(transactions);
  return {
    latestTransactionDate: buckets.latestDate,
    netWorthTrends: buildNetWorthRangeTrendsFromBuckets(currentNetWorth, buckets),
    spendingTrend: getRecentMonthKeys(buckets.latestMonth, 6).map((month) => ({
      label: formatMonthLabel(month),
      spending: roundMoney(buckets.spendingByMonth.get(month) ?? 0)
    }))
  };
}

/** Build 1W/1M/3M/YTD/1Y/ALL net-worth trend series purely from already-loaded transactions. */
export function buildNetWorthRangeTrends(
  currentNetWorth: number,
  transactions: Transaction[]
): NetWorthRangeTrend[] {
  return buildNetWorthRangeTrendsFromBuckets(currentNetWorth, bucketTransactionTrends(transactions));
}

function buildNetWorthRangeTrendsFromBuckets(
  currentNetWorth: number,
  buckets: TransactionTrendBuckets
): NetWorthRangeTrend[] {
  const { earliestMonth, latestDate, latestMonth, netCashFlowByDate, netCashFlowByMonth } = buckets;
  const latestYear = Number.parseInt(latestDate.slice(0, 4), 10);
  const ytdMonthCount = monthDifference(`${latestYear}-01`, latestMonth) + 1;

  return [
    {
      label: "1W",
      points: createDailyNetWorthTrend(currentNetWorth, netCashFlowByDate, latestDate, 7)
    },
    {
      label: "1M",
      points: createDailyNetWorthTrend(currentNetWorth, netCashFlowByDate, latestDate, 30)
    },
    {
      label: "3M",
      points: createMonthlyNetWorthTrend(currentNetWorth, netCashFlowByMonth, getRecentMonthKeys(latestMonth, 3))
    },
    {
      label: "YTD",
      points: createMonthlyNetWorthTrend(currentNetWorth, netCashFlowByMonth, getRecentMonthKeys(latestMonth, ytdMonthCount))
    },
    {
      label: "1Y",
      points: createMonthlyNetWorthTrend(currentNetWorth, netCashFlowByMonth, getRecentMonthKeys(latestMonth, 12))
    },
    {
      label: "ALL",
      points: createMonthlyNetWorthTrend(currentNetWorth, netCashFlowByMonth, getMonthRange(earliestMonth, latestMonth))
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
  netCashFlowByDate: Map<string, number>,
  latestDate: string,
  dayCount: number
) {
  const keys = getRecentDateKeys(latestDate, dayCount);
  return createBackwardNetWorthPoints(currentNetWorth, keys, netCashFlowByDate, formatDateLabel);
}

function createMonthlyNetWorthTrend(currentNetWorth: number, netCashFlowByMonth: Map<string, number>, months: string[]) {
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

function getRecentMonthKeys(latestMonth: string, count: number) {
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

function bucketTransactionTrends(transactions: Transaction[]): TransactionTrendBuckets {
  const fallbackDate = new Date().toISOString().slice(0, 10);
  let earliestMonth = "";
  let latestDate = "";
  let latestMonth = "";
  const netCashFlowByDate = new Map<string, number>();
  const netCashFlowByMonth = new Map<string, number>();
  const spendingByMonth = new Map<string, number>();

  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    if (!latestDate || transaction.date > latestDate) latestDate = transaction.date;
    if (!latestMonth || month > latestMonth) latestMonth = month;
    if (!earliestMonth || month < earliestMonth) earliestMonth = month;
    netCashFlowByDate.set(
      transaction.date,
      roundMoney((netCashFlowByDate.get(transaction.date) ?? 0) + transaction.amount)
    );
    netCashFlowByMonth.set(
      month,
      roundMoney((netCashFlowByMonth.get(month) ?? 0) + transaction.amount)
    );
    if (isSpendingTransaction(transaction)) {
      spendingByMonth.set(month, (spendingByMonth.get(month) ?? 0) + Math.abs(transaction.amount));
    }
  }

  latestDate ||= fallbackDate;
  latestMonth ||= latestDate.slice(0, 7);
  earliestMonth ||= latestMonth;

  return {
    earliestMonth,
    latestDate,
    latestMonth,
    netCashFlowByDate,
    netCashFlowByMonth,
    spendingByMonth
  };
}

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T12:00:00Z`);
  const year = String(date.getUTCFullYear() % 100).padStart(2, "0");
  return `${monthLabelFormatter.format(date)} '${year}`;
}

function formatDateLabel(date: string) {
  return dateLabelFormatter.format(new Date(`${date}T12:00:00Z`));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
