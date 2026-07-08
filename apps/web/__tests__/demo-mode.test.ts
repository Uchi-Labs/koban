import { describe, expect, it } from "vitest";
import { demoFactor, scrambleAccounts, scrambleAmount, scrambleTransactions } from "@/lib/demo-mode";

describe("demo mode scrambling", () => {
  it("is deterministic and never returns the real value at a different magnitude class", () => {
    expect(scrambleAmount(1000, "acct_a")).toBe(scrambleAmount(1000, "acct_a"));
    expect(demoFactor("acct_a")).toBeGreaterThanOrEqual(0.45);
    expect(demoFactor("acct_a")).toBeLessThanOrEqual(1.9);
    expect(demoFactor("acct_a")).not.toBe(demoFactor("acct_b"));
  });

  it("scrambles an account and its transactions with the same factor (internally consistent)", () => {
    const [account] = scrambleAccounts([
      { availableBalance: 500, currentBalance: 1000, id: "acct_a", mask: "1234" }
    ]);
    const [transaction] = scrambleTransactions([{ accountId: "acct_a", amount: -100 }]);

    const factor = demoFactor("acct_a");
    expect(account.currentBalance).toBe(Math.round(1000 * factor * 100) / 100);
    expect(transaction.amount).toBe(Math.round(-100 * factor * 100) / 100);
    expect(account.mask).not.toBe("1234");
    expect(account.mask).toMatch(/^\d{4}$/);
  });

  it("preserves sign and zero", () => {
    expect(scrambleAmount(0, "acct_a")).toBe(0);
    expect(scrambleAmount(-50, "acct_a")).toBeLessThan(0);
  });
});
