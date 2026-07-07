import { describe, expect, it } from "vitest";
import type { AccountBalanceSnapshot } from "@/lib/finance-data";
import {
  accountHistory,
  aggregatePortfolioHistory,
  computeHoldingWeights,
  computePortfolioChange,
  toUnixSeconds,
  tradingViewSymbol
} from "@/lib/investments";

function snapshot(partial: Partial<AccountBalanceSnapshot> & { accountId: string; capturedAt: string; ledgerBalance: number }): AccountBalanceSnapshot {
  return {
    id: `${partial.accountId}-${partial.capturedAt}`,
    asOfDate: partial.capturedAt.slice(0, 10),
    availableBalance: undefined,
    currency: "USD",
    source: "snaptrade",
    ...partial
  };
}

describe("tradingViewSymbol", () => {
  it("maps equities to their plain ticker", () => {
    expect(tradingViewSymbol({ symbol: "aapl" }, { institutionName: "Fidelity", name: "Individual" })).toBe("AAPL");
  });

  it("maps Coinbase crypto positions to the COINBASE:<SYMBOL>USD form", () => {
    expect(tradingViewSymbol({ symbol: "BTC" }, { institutionName: "Coinbase", name: "Coinbase" })).toBe("COINBASE:BTCUSD");
  });

  it("does not double-append USD for crypto tickers already ending in USD", () => {
    expect(tradingViewSymbol({ symbol: "ETHUSD" }, { institutionName: "Coinbase", name: "Wallet" })).toBe("COINBASE:ETHUSD");
  });

  it("returns null when there is no ticker", () => {
    expect(tradingViewSymbol({ symbol: "  " }, { institutionName: "Fidelity", name: "RSU" })).toBeNull();
  });
});

describe("computeHoldingWeights", () => {
  it("computes weight as a percentage of total market value", () => {
    const weighted = computeHoldingWeights([{ marketValue: 75 }, { marketValue: 25 }]);
    expect(weighted[0].weight).toBeCloseTo(75);
    expect(weighted[1].weight).toBeCloseTo(25);
  });

  it("returns zero weights when the total is zero", () => {
    const weighted = computeHoldingWeights([{ marketValue: 0 }, { marketValue: 0 }]);
    expect(weighted.every((position) => position.weight === 0)).toBe(true);
  });
});

describe("aggregatePortfolioHistory", () => {
  it("sums the most-recent-known balance of each account at every snapshot time", () => {
    const snapshots = [
      snapshot({ accountId: "a", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 100 }),
      snapshot({ accountId: "b", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 50 }),
      // Later, only account a re-syncs: b's last-known balance carries forward.
      snapshot({ accountId: "a", capturedAt: "2026-02-01T00:00:00Z", ledgerBalance: 120 })
    ];

    const history = aggregatePortfolioHistory(["a", "b"], snapshots);
    expect(history).toHaveLength(2);
    expect(history[0].value).toBe(150);
    expect(history[1].value).toBe(170);
    expect(history[0].time).toBeLessThan(history[1].time);
  });

  it("ignores snapshots for accounts outside the investment set", () => {
    const snapshots = [
      snapshot({ accountId: "a", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 100 }),
      snapshot({ accountId: "cash", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 999 })
    ];
    const history = aggregatePortfolioHistory(["a"], snapshots);
    expect(history).toEqual([{ time: toUnixSeconds("2026-01-01T00:00:00Z"), value: 100 }]);
  });

  it("returns an empty timeline when there are no relevant snapshots", () => {
    expect(aggregatePortfolioHistory(["a"], [])).toEqual([]);
  });

  it("excludes an account from the sum before its first real observation, then includes it from that point on", () => {
    // Simulates an RSU-style account whose provider backfill was discarded as
    // unusable (all-zero) — it has no history at all until its first live
    // sync, which lands well after account "a" already has a long history.
    const snapshots = [
      snapshot({ accountId: "a", capturedAt: "2025-07-07T00:00:00Z", ledgerBalance: 1000 }),
      snapshot({ accountId: "a", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 1200 }),
      // Account "rsu" only ever has one real observation, arriving late.
      snapshot({ accountId: "rsu", capturedAt: "2026-07-06T00:00:00Z", ledgerBalance: 276818.56 })
    ];

    const history = aggregatePortfolioHistory(["a", "rsu"], snapshots);
    expect(history).toHaveLength(3);
    // Before "rsu" has any observation, it contributes nothing to the sum.
    expect(history[0].value).toBe(1000);
    expect(history[1].value).toBe(1200);
    // The moment "rsu" is first observed, the full jump is honest, not smoothed.
    expect(history[2].value).toBeCloseTo(1200 + 276818.56);
  });

  it("does not conflate accounts updating at the same instant (applies all updates for a time before summing)", () => {
    const snapshots = [
      snapshot({ accountId: "a", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 100 }),
      snapshot({ accountId: "b", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 200 })
    ];
    const history = aggregatePortfolioHistory(["a", "b"], snapshots);
    expect(history).toEqual([{ time: toUnixSeconds("2026-01-01T00:00:00Z"), value: 300 }]);
  });
});

describe("accountHistory", () => {
  it("returns a single account's balance points sorted ascending in time", () => {
    const snapshots = [
      snapshot({ accountId: "a", capturedAt: "2026-02-01T00:00:00Z", ledgerBalance: 120 }),
      snapshot({ accountId: "a", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 100 }),
      snapshot({ accountId: "b", capturedAt: "2026-01-01T00:00:00Z", ledgerBalance: 5 })
    ];
    const history = accountHistory("a", snapshots);
    expect(history.map((point) => point.value)).toEqual([100, 120]);
  });
});

describe("computePortfolioChange", () => {
  it("computes amount and percent from first to last point", () => {
    const change = computePortfolioChange([
      { time: 1, value: 200 },
      { time: 2, value: 250 }
    ]);
    expect(change).not.toBeNull();
    expect(change?.amount).toBe(50);
    expect(change?.percent).toBeCloseTo(25);
  });

  it("returns null with fewer than two points (honest empty state)", () => {
    expect(computePortfolioChange([{ time: 1, value: 200 }])).toBeNull();
    expect(computePortfolioChange([])).toBeNull();
  });
});
