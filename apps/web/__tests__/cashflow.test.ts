import { describe, expect, it } from "vitest";
import {
  buildMonthlySeries,
  comparisonOffsetMonths,
  computeDelta,
  computeTotals,
  resolveChartMonths,
  resolveComparisonRange,
  resolvePeriodRange,
  topSpendCategoryIds,
  type CashflowTxn
} from "@/lib/cashflow";

const txns: CashflowTxn[] = [
  { amount: 5000, categoryId: "cat_income", date: "2026-01-15" }, // income
  { amount: -1200, categoryId: "cat_groceries", date: "2026-01-20" }, // spend
  { amount: -800, categoryId: "cat_dining", date: "2026-01-25" }, // spend
  { amount: 3000, categoryId: "cat_income", date: "2026-02-15" }, // income
  { amount: -2000, categoryId: "cat_groceries", date: "2026-02-18" }, // spend
  { amount: -5000, categoryId: "cat_transfer", date: "2026-02-19" }, // transfer outflow (excluded)
  { amount: 5000, categoryId: "cat_transfer", date: "2026-02-20" } // transfer inflow (excluded)
];

const january = { end: "2026-01-31", start: "2026-01-01" };
const february = { end: "2026-02-28", start: "2026-02-01" };

describe("computeTotals", () => {
  it("computes income, spend, and net for a month", () => {
    expect(computeTotals(txns, january, false)).toEqual({ income: 5000, net: 3000, spend: 2000 });
  });

  it("excludes transfers from income and spend by default", () => {
    // Feb: income 3000, spend 2000 — the ±5000 transfers are ignored.
    expect(computeTotals(txns, february, false)).toEqual({ income: 3000, net: 1000, spend: 2000 });
  });

  it("folds transfers back in on both sides when excluded spend is shown", () => {
    // Feb with excluded: income 3000+5000, spend 2000+5000, net stays 1000.
    expect(computeTotals(txns, february, true)).toEqual({ income: 8000, net: 1000, spend: 7000 });
  });
});

describe("buildMonthlySeries", () => {
  it("produces per-month income, spend, and net with transfers excluded", () => {
    const series = buildMonthlySeries({
      comparisonOffsetMonths: 12,
      includeExcluded: false,
      months: ["2026-01", "2026-02", "2026-03"],
      referenceMonth: "2026-02",
      txns
    });

    expect(series[0]).toMatchObject({ income: 5000, month: "2026-01", net: 3000, spend: 2000 });
    expect(series[1]).toMatchObject({ income: 3000, month: "2026-02", net: 1000, spend: 2000 });
    expect(series[1].spendByCategory).toEqual({ cat_groceries: 2000 });
    expect(series[2]).toMatchObject({ income: 0, isFuture: true, month: "2026-03", net: 0, spend: 0 });
  });

  it("aligns the comparison month by the given offset", () => {
    const series = buildMonthlySeries({
      comparisonOffsetMonths: 1,
      includeExcluded: false,
      months: ["2026-02"],
      referenceMonth: "2026-02",
      txns
    });

    // Comparison month is January — its net (3000) surfaces on the February point.
    expect(series[0].comparisonMonth).toBe("2026-01");
    expect(series[0].comparisonNet).toBe(3000);
  });
});

describe("topSpendCategoryIds", () => {
  it("orders categories by total spend", () => {
    const series = buildMonthlySeries({
      comparisonOffsetMonths: 12,
      includeExcluded: false,
      months: ["2026-01", "2026-02"],
      referenceMonth: "2026-02",
      txns
    });

    // groceries 1200+2000=3200 > dining 800.
    expect(topSpendCategoryIds(series)).toEqual(["cat_groceries", "cat_dining"]);
  });
});

describe("resolvePeriodRange", () => {
  it("returns Jan 1 through the reference date for YTD", () => {
    expect(resolvePeriodRange("ytd", "2026-07-07")).toEqual({ end: "2026-07-07", start: "2026-01-01" });
  });

  it("returns the prior full month for last_month", () => {
    expect(resolvePeriodRange("last_month", "2026-07-07")).toEqual({ end: "2026-06-30", start: "2026-06-01" });
  });

  it("returns a trailing 12-month window for last_12_months", () => {
    expect(resolvePeriodRange("last_12_months", "2026-07-07")).toEqual({ end: "2026-07-07", start: "2025-08-01" });
  });
});

describe("comparison ranges", () => {
  it("steps YTD back a full year for previous period", () => {
    expect(comparisonOffsetMonths("ytd", "previous_period")).toBe(12);
    const range = resolvePeriodRange("ytd", "2026-07-07");
    expect(resolveComparisonRange(range, 12)).toEqual({ end: "2025-07-07", start: "2025-01-01" });
  });

  it("steps a single-month preset back one month for previous period", () => {
    expect(comparisonOffsetMonths("this_month", "previous_period")).toBe(1);
  });

  it("always steps back a year for previous year", () => {
    expect(comparisonOffsetMonths("this_month", "previous_year")).toBe(12);
  });
});

describe("resolveChartMonths", () => {
  it("spans the calendar year for YTD", () => {
    const months = resolveChartMonths("ytd", "2026-07-07");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-01");
    expect(months[11]).toBe("2026-12");
  });

  it("spans a trailing 12 months for last_12_months", () => {
    const months = resolveChartMonths("last_12_months", "2026-07-07");
    expect(months[0]).toBe("2025-08");
    expect(months[11]).toBe("2026-07");
  });
});

describe("computeDelta", () => {
  it("computes a signed percent decrease", () => {
    const delta = computeDelta(2202.16, 55223.26);
    expect(delta.direction).toBe("down");
    expect(delta.pct).toBeCloseTo(-96.01, 1);
  });

  it("returns a null percent when the previous value is zero", () => {
    expect(computeDelta(100, 0).pct).toBeNull();
  });
});
