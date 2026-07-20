import type { Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { buildNetWorthRangeTrends } from "@/lib/net-worth-trend";

function transaction(id: string, date: string, amount: number): Transaction {
  return {
    accountId: "acct_checking",
    amount,
    categoryId: amount < 0 ? "cat_food" : "cat_income",
    currency: "USD",
    date,
    description: id,
    id,
    merchantName: id,
    providerConnectionId: "provider_test",
    reviewed: false,
    status: "posted",
    tags: []
  };
}

describe("buildNetWorthRangeTrends", () => {
  it("preserves the previous six-range output for a cross-year fixture", () => {
    const trends = buildNetWorthRangeTrends(1_000, [
      transaction("dec-income", "2025-12-15", 100),
      transaction("jan-spend", "2026-01-02", -50),
      transaction("jan-income", "2026-01-30", 200),
      transaction("feb-spend-a", "2026-02-01", -25),
      transaction("feb-spend-b", "2026-02-28", -75),
      transaction("mar-income", "2026-03-01", 10)
    ]);

    expect(trends.map((trend) => trend.label)).toEqual(["1W", "1M", "3M", "YTD", "1Y", "ALL"]);
    expect(trends.map((trend) => trend.points.map((point) => point.value))).toEqual([
      [1065, 1065, 1065, 1065, 1065, 990, 1000],
      [1090, ...Array(27).fill(1065), 990, 1000],
      [1090, 990, 1000],
      [1090, 990, 1000],
      [...Array(8).fill(840), 940, 1090, 990, 1000],
      [940, 1090, 990, 1000]
    ]);
    expect(trends.map((trend) => [trend.points[0]?.label, trend.points.at(-1)?.label])).toEqual([
      ["Feb 23", "Mar 1"],
      ["Jan 31", "Mar 1"],
      ["Jan '26", "Mar '26"],
      ["Jan '26", "Mar '26"],
      ["Apr '25", "Mar '26"],
      ["Dec '25", "Mar '26"]
    ]);
  });
});
