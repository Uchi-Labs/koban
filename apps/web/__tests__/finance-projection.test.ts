import type { Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { createMonthlySpendingProjection } from "@/lib/finance-projection";

describe("createMonthlySpendingProjection", () => {
  it("damps early-month pace against trailing monthly spend", () => {
    const projection = createMonthlySpendingProjection({
      latestDate: "2026-05-03",
      monthlySpending: 1900,
      transactions: [
        spendingTransaction("txn_feb", "2026-02-12", -4000),
        spendingTransaction("txn_mar", "2026-03-12", -4000),
        spendingTransaction("txn_apr", "2026-04-12", -4000),
        spendingTransaction("txn_may", "2026-05-03", -1900)
      ]
    });

    expect(projection.confidence).toBe("early");
    expect(projection.paceProjection).toBe(19633.33);
    expect(projection.trailingAverage).toBe(4000);
    expect(projection.amount).toBe(6814);
    expect(projection.amount).toBeLessThan(10000);
  });

  it("leans more heavily on month-to-date pace after the early window", () => {
    const projection = createMonthlySpendingProjection({
      latestDate: "2026-06-20",
      monthlySpending: 1200,
      transactions: [
        spendingTransaction("txn_mar", "2026-03-12", -3000),
        spendingTransaction("txn_apr", "2026-04-12", -3000),
        spendingTransaction("txn_may", "2026-05-12", -3000),
        spendingTransaction("txn_jun", "2026-06-20", -1200)
      ]
    });

    expect(projection.confidence).toBe("blended");
    expect(projection.paceWeight).toBeGreaterThan(0.6);
    expect(Math.abs(projection.amount - projection.paceProjection)).toBeLessThan(
      Math.abs(projection.amount - projection.trailingAverage)
    );
  });
});

function spendingTransaction(id: string, date: string, amount: number): Transaction {
  return {
    accountId: "acct_card",
    amount,
    categoryId: "cat_food",
    currency: "USD",
    date,
    description: "Card purchase",
    id,
    merchantName: "Merchant",
    postedDate: date,
    providerConnectionId: "provider_plaid_test",
    reviewed: false,
    status: "posted",
    tags: []
  };
}
