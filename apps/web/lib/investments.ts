import type { Account, InvestmentPosition } from "@ai-finances/schema";
import { displayCurrencyCode } from "@/lib/currency";
import {
  buildDemoFactors,
  isDemoModeEnabled,
  scrambleAccounts,
  scrambleBalanceSnapshots,
  scramblePositions
} from "@/lib/demo-mode";
import type { AccountBalanceSnapshot } from "@/lib/finance-data";
import { readFinanceDbSnapshot, listInvestmentPositions } from "@/lib/db/finance-db";

/** A point on a Liveline chart. `time` is unix seconds. */
export interface PortfolioPoint {
  time: number;
  value: number;
}

export interface HoldingView {
  id: string;
  symbol: string;
  description: string;
  accountId: string;
  accountName: string;
  units: number;
  price?: number;
  marketValue: number;
  /** Average purchase price per share/unit, when the provider reports it. */
  costBasis?: number;
  /** Total cost basis for the position (costBasis × units), when known. */
  costBasisValue?: number;
  /** Total (open) unrealized gain/loss: marketValue − costBasisValue. */
  unrealizedPnl?: number;
  /** Unrealized gain/loss as a percentage of cost basis. */
  unrealizedPnlPercent?: number;
  currency: string;
  /** Portfolio weight as a percentage (0-100) of total holdings market value. */
  weight: number;
  tradingViewSymbol: string | null;
}

/**
 * Total (open) unrealized gain/loss for a position from its stored per-unit cost
 * basis. Returns empty fields when cost basis is unknown — we never fabricate a
 * gain, and SnapTrade positions carry no intraday/day-change figure, so there is
 * deliberately no "today's gain" here.
 */
export function computeUnrealized(position: {
  units: number;
  marketValue: number;
  costBasis?: number;
}): { costBasisValue?: number; unrealizedPnl?: number; unrealizedPnlPercent?: number } {
  if (position.costBasis === undefined) {
    return {};
  }

  const costBasisValue = roundMoney(position.costBasis * position.units);
  const unrealizedPnl = roundMoney(position.marketValue - costBasisValue);
  const unrealizedPnlPercent = costBasisValue !== 0 ? (unrealizedPnl / Math.abs(costBasisValue)) * 100 : undefined;

  return { costBasisValue, unrealizedPnl, unrealizedPnlPercent };
}

export interface InvestmentAccountView {
  id: string;
  institutionName: string;
  name: string;
  mask?: string;
  type: Account["type"];
  balance: number;
  currency: string;
  lastSyncedAt: string;
  history: PortfolioPoint[];
  positions: HoldingView[];
}

export interface PortfolioChange {
  amount: number;
  percent: number;
}

export interface InvestmentsData {
  totalMarketValue: number;
  currency: string;
  asOf: string;
  change: PortfolioChange | null;
  history: PortfolioPoint[];
  accounts: InvestmentAccountView[];
  holdings: HoldingView[];
  /** Total cost basis summed over holdings that report it (undefined when none do). */
  totalCostBasis?: number;
  /** Total (open) unrealized gain/loss across holdings that report cost basis. */
  totalUnrealizedPnl?: number;
  /** Total unrealized gain/loss as a percentage of covered cost basis. */
  totalUnrealizedPnlPercent?: number;
  /**
   * Honest coverage for the total gain: how many holdings carry cost basis, and
   * the market value those holdings represent. `coveredMarketValue` is usually far
   * below `totalMarketValue` because some accounts (e.g. RSU accounts) sync a
   * balance but no position-level rows, so their gain cannot be computed.
   */
  costBasisCoverage: { withCostBasis: number; total: number; coveredMarketValue: number };
}

/** Convert an ISO timestamp (or plain date) to unix seconds, best effort. */
export function toUnixSeconds(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/**
 * Map an investment position to a best-effort TradingView symbol.
 * Crypto (Coinbase) positions use the `COINBASE:<SYMBOL>USD` exchange form;
 * equities use the plain ticker. Returns null when no ticker is present.
 */
export function tradingViewSymbol(
  position: Pick<InvestmentPosition, "symbol">,
  account: Pick<Account, "institutionName" | "name"> | undefined
): string | null {
  const ticker = position.symbol.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");

  if (!ticker) {
    return null;
  }

  const institution = `${account?.institutionName ?? ""} ${account?.name ?? ""}`.toLowerCase();
  const isCrypto = institution.includes("coinbase");

  if (isCrypto) {
    const base = ticker.replace(/USD$/, "");
    return base ? `COINBASE:${base}USD` : null;
  }

  return ticker;
}

/** Compute each holding's weight as a percentage of the total holdings market value. */
export function computeHoldingWeights<T extends { marketValue: number }>(
  positions: T[]
): Array<T & { weight: number }> {
  const total = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);

  return positions.map((position) => ({
    ...position,
    weight: total > 0 ? (Math.abs(position.marketValue) / total) * 100 : 0
  }));
}

/**
 * Aggregate a portfolio-value timeline with coverage-aware last-known-value
 * semantics: build the union of every account's snapshot times, and at each
 * time sum each account's most recent observed value at-or-before that time
 * — carrying real observations forward, never interpolating or synthesizing.
 * An account contributes nothing before its first observation exists, so an
 * account whose earliest real data point lands late (e.g. a provider backfill
 * that had to be discarded as unusable and is only first observed at a later
 * live sync) will produce a visible composition jump the moment it appears —
 * that jump is honest and must not be smoothed away. Sparse input (one point
 * per sync) yields a sparse but honest timeline — never fabricated.
 */
export function aggregatePortfolioHistory(
  accountIds: string[],
  snapshots: AccountBalanceSnapshot[]
): PortfolioPoint[] {
  const accountIdSet = new Set(accountIds);
  const relevant = snapshots
    .filter((snapshot) => accountIdSet.has(snapshot.accountId))
    .map((snapshot) => ({
      accountId: snapshot.accountId,
      time: toUnixSeconds(snapshot.capturedAt || snapshot.asOfDate),
      value: snapshot.ledgerBalance
    }))
    .filter((snapshot) => snapshot.time > 0)
    .sort((left, right) => left.time - right.time);

  if (relevant.length === 0) {
    return [];
  }

  // Last-known balance per account, carried forward across snapshot times.
  const lastBalanceByAccount = new Map<string, number>();
  const pointByTime = new Map<number, number>();

  // Group snapshots that share a time so we apply them together before summing.
  const timesInOrder: number[] = [];
  const snapshotsByTime = new Map<number, Array<{ accountId: string; value: number }>>();

  for (const snapshot of relevant) {
    if (!snapshotsByTime.has(snapshot.time)) {
      snapshotsByTime.set(snapshot.time, []);
      timesInOrder.push(snapshot.time);
    }
    snapshotsByTime.get(snapshot.time)!.push({ accountId: snapshot.accountId, value: snapshot.value });
  }

  for (const time of timesInOrder) {
    for (const { accountId, value } of snapshotsByTime.get(time)!) {
      lastBalanceByAccount.set(accountId, value);
    }

    let total = 0;
    for (const balance of lastBalanceByAccount.values()) {
      total += balance;
    }
    pointByTime.set(time, roundMoney(total));
  }

  return timesInOrder.map((time) => ({ time, value: pointByTime.get(time) ?? 0 }));
}

/** Build a single account's balance timeline from its snapshots. */
export function accountHistory(accountId: string, snapshots: AccountBalanceSnapshot[]): PortfolioPoint[] {
  return snapshots
    .filter((snapshot) => snapshot.accountId === accountId)
    .map((snapshot) => ({
      time: toUnixSeconds(snapshot.capturedAt || snapshot.asOfDate),
      value: roundMoney(snapshot.ledgerBalance)
    }))
    .filter((point) => point.time > 0)
    .sort((left, right) => left.time - right.time);
}

/** Groups every account's snapshot history in one pass, preserving chronological order. */
export function accountHistories(snapshots: AccountBalanceSnapshot[]): Map<string, PortfolioPoint[]> {
  const historyByAccountId = new Map<string, PortfolioPoint[]>();

  for (const snapshot of snapshots) {
    const point = {
      time: toUnixSeconds(snapshot.capturedAt || snapshot.asOfDate),
      value: roundMoney(snapshot.ledgerBalance)
    };
    if (point.time <= 0) {
      continue;
    }
    const history = historyByAccountId.get(snapshot.accountId) ?? [];
    history.push(point);
    historyByAccountId.set(snapshot.accountId, history);
  }

  for (const history of historyByAccountId.values()) {
    history.sort((left, right) => left.time - right.time);
  }

  return historyByAccountId;
}

/** Compute portfolio period change from first→last point of a value timeline. */
export function computePortfolioChange(history: PortfolioPoint[]): PortfolioChange | null {
  if (history.length < 2) {
    return null;
  }

  const first = history[0].value;
  const last = history[history.length - 1].value;
  const amount = roundMoney(last - first);
  const percent = first !== 0 ? (amount / Math.abs(first)) * 100 : 0;

  return { amount, percent };
}

/** Assemble the full investments view model from finance-db read paths. */
export async function getInvestmentsData(): Promise<InvestmentsData> {
  const snapshot = await readFinanceDbSnapshot();
  const demoMode = await isDemoModeEnabled();
  const rawAccounts = (snapshot?.accounts ?? []).filter((account) => account.type === "investment");
  const demoFactors = buildDemoFactors(rawAccounts);
  const accounts = demoMode ? scrambleAccounts(rawAccounts, demoFactors) : rawAccounts;
  const rawBalanceSnapshots = snapshot?.balanceSnapshots ?? [];
  const balanceSnapshots = demoMode ? scrambleBalanceSnapshots(rawBalanceSnapshots, demoFactors) : rawBalanceSnapshots;
  const accountIds = accounts.map((account) => account.id);
  const rawPositions = accountIds.length > 0 ? await listInvestmentPositions(accountIds) : [];
  const positions = demoMode ? scramblePositions(rawPositions, demoFactors) : rawPositions;
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  // TradingView symbols resolve off the real brokerage — scrambled institution names would break them.
  const rawAccountById = new Map(rawAccounts.map((account) => [account.id, account]));

  const weightedPositions = computeHoldingWeights(positions);
  const holdings: HoldingView[] = weightedPositions.map((position) => {
    const account = accountById.get(position.accountId);
    const { costBasisValue, unrealizedPnl, unrealizedPnlPercent } = computeUnrealized(position);
    return {
      id: position.id,
      symbol: position.symbol,
      description: position.description,
      accountId: position.accountId,
      accountName: account ? `${account.institutionName} ${account.name}`.trim() : position.accountId,
      units: position.units,
      price: position.price,
      marketValue: position.marketValue,
      costBasis: position.costBasis,
      costBasisValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      currency: position.currency,
      weight: position.weight,
      tradingViewSymbol: tradingViewSymbol(position, rawAccountById.get(position.accountId) ?? account)
    };
  });

  const holdingsByAccount = new Map<string, HoldingView[]>();
  for (const holding of holdings) {
    holdingsByAccount.set(holding.accountId, [...(holdingsByAccount.get(holding.accountId) ?? []), holding]);
  }
  const historyByAccountId = accountHistories(balanceSnapshots);

  const accountViews: InvestmentAccountView[] = accounts.map((account) => ({
    id: account.id,
    institutionName: account.institutionName,
    name: account.name,
    mask: account.mask,
    type: account.type,
    balance: account.currentBalance,
    currency: account.currency,
    lastSyncedAt: account.lastUpdatedAt,
    history: historyByAccountId.get(account.id) ?? [],
    positions: (holdingsByAccount.get(account.id) ?? []).sort(
      (left, right) => Math.abs(right.marketValue) - Math.abs(left.marketValue)
    )
  }));

  const history = aggregatePortfolioHistory(accountIds, balanceSnapshots);
  const totalMarketValue = roundMoney(
    accounts.reduce((sum, account) => sum + account.currentBalance, 0)
  );
  const currency = displayCurrencyCode(accounts.map((account) => account.currency));

  // Portfolio-level unrealized gain/loss covers only holdings that report cost
  // basis; coverage is surfaced so a partial figure is never presented as complete.
  const covered = holdings.filter((holding) => holding.unrealizedPnl !== undefined);
  const totalCostBasis =
    covered.length > 0 ? roundMoney(covered.reduce((sum, holding) => sum + (holding.costBasisValue ?? 0), 0)) : undefined;
  const totalUnrealizedPnl =
    covered.length > 0 ? roundMoney(covered.reduce((sum, holding) => sum + (holding.unrealizedPnl ?? 0), 0)) : undefined;
  const totalUnrealizedPnlPercent =
    totalCostBasis !== undefined && totalCostBasis !== 0 && totalUnrealizedPnl !== undefined
      ? (totalUnrealizedPnl / Math.abs(totalCostBasis)) * 100
      : undefined;

  return {
    totalMarketValue,
    currency,
    asOf: snapshot?.lastSyncedAt ?? new Date().toISOString(),
    change: computePortfolioChange(history),
    history,
    accounts: accountViews.sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance)),
    holdings: holdings.sort((left, right) => Math.abs(right.marketValue) - Math.abs(left.marketValue)),
    totalCostBasis,
    totalUnrealizedPnl,
    totalUnrealizedPnlPercent,
    costBasisCoverage: {
      withCostBasis: covered.length,
      total: holdings.length,
      coveredMarketValue: roundMoney(covered.reduce((sum, holding) => sum + holding.marketValue, 0))
    }
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
