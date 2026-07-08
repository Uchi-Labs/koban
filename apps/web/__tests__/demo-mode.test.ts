import { describe, expect, it } from "vitest";
import {
  accountDemoFactor,
  buildDemoFactors,
  scrambleAccounts,
  scrambleBalanceSnapshots,
  scramblePositions,
  scrambleTransactions,
  squashAmount
} from "@/lib/demo-mode";

const account = {
  availableBalance: 250000,
  currentBalance: 276818,
  id: "acct_big",
  institutionName: "Fidelity",
  mask: "8804",
  name: "BNY RSU",
  type: "investment"
};

describe("demo mode scrambling", () => {
  it("squashes large balances into a modest range, deterministically", () => {
    const squashed = Math.abs(squashAmount(276818, "acct_big"));
    expect(squashed).toBeGreaterThan(15000);
    expect(squashed).toBeLessThan(31000);
    expect(squashAmount(276818, "acct_big")).toBe(squashAmount(276818, "acct_big"));
    expect(squashAmount(0, "acct_big")).toBe(0);
    expect(squashAmount(-4097, "acct_card")).toBeLessThan(0);
  });

  it("replaces account identity and scales balances by the account factor", () => {
    const factors = buildDemoFactors([account]);
    const [scrambled] = scrambleAccounts([account], factors);

    expect(scrambled.name).not.toBe("BNY RSU");
    expect(scrambled.institutionName).not.toBe("Fidelity");
    expect(scrambled.mask).toMatch(/^\d{4}$/);
    expect(scrambled.mask).not.toBe("8804");
    expect(scrambled.currentBalance).toBeCloseTo(276818 * accountDemoFactor(account), 1);

    // snapshots and positions share the same linear factor → chart shapes survive
    const [snap] = scrambleBalanceSnapshots([{ accountId: "acct_big", ledgerBalance: 100000 }], factors);
    expect(snap.ledgerBalance).toBeCloseTo(100000 * accountDemoFactor(account), 1);
    const [position] = scramblePositions([{ accountId: "acct_big", marketValue: 10000, units: 50 }], factors);
    expect(position.marketValue).toBeCloseTo(10000 * accountDemoFactor(account), 1);
    expect(position.units).toBeCloseTo(50 * accountDemoFactor(account), 3);
  });

  it("keeps transaction amounts life-sized via a per-merchant factor", () => {
    const [netflix] = scrambleTransactions([{ accountId: "acct_a", amount: -12.99, merchantName: "NETFLIX" }]);
    expect(netflix.amount).toBeLessThan(0);
    expect(Math.abs(netflix.amount)).toBeGreaterThan(12.99 * 0.5 - 0.01);
    expect(Math.abs(netflix.amount)).toBeLessThan(12.99 * 1.2 + 0.01);
    // same merchant, same factor everywhere
    const [again] = scrambleTransactions([{ accountId: "acct_b", amount: -12.99, merchantName: "NETFLIX" }]);
    expect(again.amount).toBe(netflix.amount);
  });
});
