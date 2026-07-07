// Cash-flow aggregation helpers — pure, isomorphic (safe to import on the client),
// and unit-testable. Money convention matches the rest of the app: outflow is
// negative, income positive. Transfers (`cat_transfer`) are excluded from
// spending/income metrics by default per lib/transaction-classification.ts; the
// "Show excluded spend" toggle folds them back in on BOTH sides so that the
// identity net = income - spend always holds.

const EXCLUDED_CATEGORY_ID = "cat_transfer";

export interface CashflowTxn {
  /** YYYY-MM-DD */
  date: string;
  /** negative outflow, positive inflow */
  amount: number;
  categoryId: string;
}

export type PeriodPreset = "ytd" | "last_12_months" | "this_month" | "last_month";
export type ComparisonMode = "previous_period" | "previous_year";

export interface DateRange {
  /** inclusive YYYY-MM-DD */
  start: string;
  /** inclusive YYYY-MM-DD */
  end: string;
}

export interface CashflowTotals {
  income: number;
  spend: number;
  net: number;
}

export interface Delta {
  /** signed percent change vs previous; null when previous is 0 (undefined base) */
  pct: number | null;
  direction: "up" | "down" | "flat";
  previous: number;
}

export interface MonthlyPoint {
  /** YYYY-MM */
  month: string;
  income: number;
  /** spend magnitude (>= 0) */
  spend: number;
  net: number;
  /** true for months after the reference month (no data expected yet) */
  isFuture: boolean;
  spendByCategory: Record<string, number>;
  comparisonMonth: string;
  comparisonIncome: number;
  comparisonSpend: number;
  comparisonNet: number;
}

// ── Classification ────────────────────────────────────────────────────────────

function isCashInflow(txn: CashflowTxn, includeExcluded: boolean): boolean {
  return txn.amount > 0 && (includeExcluded || txn.categoryId !== EXCLUDED_CATEGORY_ID);
}

function isCashOutflow(txn: CashflowTxn, includeExcluded: boolean): boolean {
  return txn.amount < 0 && (includeExcluded || txn.categoryId !== EXCLUDED_CATEGORY_ID);
}

// ── Date math (UTC, string-first to dodge timezone drift) ─────────────────────

function parseYmd(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split("-").map(Number);
  return { y, m: m ?? 1, d: d ?? 1 };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (((total % 12) + 12) % 12) + 1 };
}

function firstOfMonth(y: number, m: number): string {
  return `${pad(y, 4)}-${pad(m)}-01`;
}

function lastOfMonth(y: number, m: number): string {
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${pad(y, 4)}-${pad(m)}-${pad(day)}`;
}

function shiftDateByMonths(value: string, months: number): string {
  const { y, m, d } = parseYmd(value);
  const shifted = shiftMonth(y, m, months);
  const maxDay = new Date(Date.UTC(shifted.y, shifted.m, 0)).getUTCDate();
  return `${pad(shifted.y, 4)}-${pad(shifted.m)}-${pad(Math.min(d, maxDay))}`;
}

function shiftMonthKey(monthKey: string, months: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const shifted = shiftMonth(y, m, months);
  return `${pad(shifted.y, 4)}-${pad(shifted.m)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRecord(record: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = round(value);
  }
  return result;
}

// ── Period + comparison ranges ────────────────────────────────────────────────

export function resolvePeriodRange(preset: PeriodPreset, reference: string): DateRange {
  const { y, m } = parseYmd(reference);

  switch (preset) {
    case "ytd":
      return { start: `${pad(y, 4)}-01-01`, end: reference };
    case "this_month":
      return { start: firstOfMonth(y, m), end: reference };
    case "last_month": {
      const prev = shiftMonth(y, m, -1);
      return { start: firstOfMonth(prev.y, prev.m), end: lastOfMonth(prev.y, prev.m) };
    }
    case "last_12_months": {
      const start = shiftMonth(y, m, -11);
      return { start: firstOfMonth(start.y, start.m), end: reference };
    }
  }
}

/**
 * How far back the comparison window sits, in months.
 * "Previous year" always steps back a full year. "Previous period" steps back by
 * the natural cycle of the preset (a year for year-scale windows, a month for the
 * single-month presets) — matching Copilot's YTD-vs-same-span-last-year behavior.
 */
export function comparisonOffsetMonths(preset: PeriodPreset, comparison: ComparisonMode): number {
  if (comparison === "previous_year") {
    return 12;
  }

  switch (preset) {
    case "this_month":
    case "last_month":
      return 1;
    default:
      return 12;
  }
}

export function resolveComparisonRange(range: DateRange, offsetMonths: number): DateRange {
  return {
    start: shiftDateByMonths(range.start, -offsetMonths),
    end: shiftDateByMonths(range.end, -offsetMonths)
  };
}

/** 12 month keys (YYYY-MM) spanning the chart x-axis. */
export function resolveChartMonths(preset: PeriodPreset, reference: string): string[] {
  const { y, m } = parseYmd(reference);

  if (preset === "last_12_months") {
    return Array.from({ length: 12 }, (_, index) => {
      const shifted = shiftMonth(y, m, index - 11);
      return `${pad(shifted.y, 4)}-${pad(shifted.m)}`;
    });
  }

  // Calendar year of the reference date (Jan → Dec), like the Copilot reference.
  return Array.from({ length: 12 }, (_, index) => `${pad(y, 4)}-${pad(index + 1)}`);
}

// ── Aggregation ───────────────────────────────────────────────────────────────

export function computeTotals(
  txns: CashflowTxn[],
  range: DateRange,
  includeExcluded: boolean
): CashflowTotals {
  let income = 0;
  let spend = 0;

  for (const txn of txns) {
    if (txn.date < range.start || txn.date > range.end) {
      continue;
    }

    if (isCashInflow(txn, includeExcluded)) {
      income += txn.amount;
    } else if (isCashOutflow(txn, includeExcluded)) {
      spend += Math.abs(txn.amount);
    }
  }

  return { income: round(income), spend: round(spend), net: round(income - spend) };
}

export function computeDelta(current: number, previous: number): Delta {
  const diff = current - previous;
  const direction = Math.abs(diff) < 0.005 ? "flat" : diff > 0 ? "up" : "down";
  const pct = previous === 0 ? null : (diff / Math.abs(previous)) * 100;

  return { pct, direction, previous };
}

export function buildMonthlySeries({
  txns,
  months,
  referenceMonth,
  includeExcluded,
  comparisonOffsetMonths: offset
}: {
  txns: CashflowTxn[];
  months: string[];
  referenceMonth: string;
  includeExcluded: boolean;
  comparisonOffsetMonths: number;
}): MonthlyPoint[] {
  const byMonth = new Map<string, { income: number; spend: number; byCat: Record<string, number> }>();

  const ensure = (monthKey: string) => {
    let bucket = byMonth.get(monthKey);
    if (!bucket) {
      bucket = { income: 0, spend: 0, byCat: {} };
      byMonth.set(monthKey, bucket);
    }
    return bucket;
  };

  for (const txn of txns) {
    const monthKey = txn.date.slice(0, 7);
    const bucket = ensure(monthKey);

    if (isCashInflow(txn, includeExcluded)) {
      bucket.income += txn.amount;
    } else if (isCashOutflow(txn, includeExcluded)) {
      const magnitude = Math.abs(txn.amount);
      bucket.spend += magnitude;
      bucket.byCat[txn.categoryId] = (bucket.byCat[txn.categoryId] ?? 0) + magnitude;
    }
  }

  return months.map((monthKey) => {
    const bucket = byMonth.get(monthKey);
    const comparisonMonth = shiftMonthKey(monthKey, -offset);
    const comparisonBucket = byMonth.get(comparisonMonth);

    return {
      month: monthKey,
      income: round(bucket?.income ?? 0),
      spend: round(bucket?.spend ?? 0),
      net: round((bucket?.income ?? 0) - (bucket?.spend ?? 0)),
      isFuture: monthKey > referenceMonth,
      spendByCategory: roundRecord(bucket?.byCat ?? {}),
      comparisonMonth,
      comparisonIncome: round(comparisonBucket?.income ?? 0),
      comparisonSpend: round(comparisonBucket?.spend ?? 0),
      comparisonNet: round((comparisonBucket?.income ?? 0) - (comparisonBucket?.spend ?? 0))
    } satisfies MonthlyPoint;
  });
}

/** Category ids ordered by total spend across the given points, capped at `limit`. */
export function topSpendCategoryIds(points: MonthlyPoint[], limit = 8): string[] {
  const totals = new Map<string, number>();

  for (const point of points) {
    for (const [categoryId, value] of Object.entries(point.spendByCategory)) {
      totals.set(categoryId, (totals.get(categoryId) ?? 0) + value);
    }
  }

  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([categoryId]) => categoryId);
}

// ── Labels ────────────────────────────────────────────────────────────────────

const monthDayFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
const monthDayYearFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric"
});
const monthShortFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthYearFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC", year: "numeric" });

/** e.g. "Jan 1 - Jul 7, 2026" (same year) or "Jan 1, 2025 - Jul 7, 2026". */
export function formatRangeLabel(range: DateRange): string {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  return sameYear
    ? `${monthDayFormatter.format(start)} - ${monthDayYearFormatter.format(end)}`
    : `${monthDayYearFormatter.format(start)} - ${monthDayYearFormatter.format(end)}`;
}

/** Axis tick: "Jan '26". */
export function formatMonthTick(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  return `${monthShortFormatter.format(date)} '${pad(date.getUTCFullYear() % 100)}`;
}

/** Endpoint / tooltip label: "Jan 2026". */
export function formatMonthLong(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  return monthYearFormatter.format(date);
}
