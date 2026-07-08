// Demo mode: deterministic scrambling of money figures for screenshots/demos.
//
// Every monetary value is multiplied by a stable per-account factor (positions,
// transactions, and balance history share their account's factor), so charts keep
// their real shapes and accounts stay internally consistent while no figure is
// the real one. Applied only at display-read boundaries (getFinanceData /
// getShellData / getInvestmentsData / goals page) — never at the DB layer, so
// sync read-modify-write paths always see real data. The UI shows a "Demo"
// badge whenever the cookie is set: scrambled numbers are never presented as real.

import { cookies } from "next/headers";

export const DEMO_MODE_COOKIE = "koban_demo";

export async function isDemoModeEnabled(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(DEMO_MODE_COOKIE)?.value === "1";
  } catch {
    // Outside a request scope (sync jobs, build-time) demo mode never applies.
    return false;
  }
}

/** FNV-1a → [0, 1). Stable across processes so the scramble doesn't shift between loads. */
function hash01(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/** Stable multiplier in [0.45, 1.9] — plausible magnitudes, wrong values. */
export function demoFactor(seed: string): number {
  return 0.45 + hash01(`koban-demo:${seed}`) * 1.45;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scrambleAmount(value: number, seed: string): number {
  return round2(value * demoFactor(seed));
}

export function scrambleMask(mask: string | undefined, seed: string): string | undefined {
  return mask ? String(Math.floor(1000 + hash01(`koban-demo-mask:${seed}`) * 9000)) : mask;
}

export function scrambleAccounts<
  T extends { id: string; currentBalance: number; availableBalance?: number; mask?: string }
>(accounts: T[]): T[] {
  return accounts.map((account) => ({
    ...account,
    availableBalance:
      account.availableBalance === undefined ? undefined : scrambleAmount(account.availableBalance, account.id),
    currentBalance: scrambleAmount(account.currentBalance, account.id),
    mask: scrambleMask(account.mask, account.id)
  }));
}

export function scrambleTransactions<T extends { accountId: string; amount: number }>(transactions: T[]): T[] {
  return transactions.map((transaction) => ({
    ...transaction,
    amount: scrambleAmount(transaction.amount, transaction.accountId)
  }));
}

export function scrambleBalanceSnapshots<
  T extends { accountId: string; ledgerBalance: number; availableBalance?: number }
>(snapshots: T[]): T[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    availableBalance:
      snapshot.availableBalance === undefined ? undefined : scrambleAmount(snapshot.availableBalance, snapshot.accountId),
    ledgerBalance: scrambleAmount(snapshot.ledgerBalance, snapshot.accountId)
  }));
}

export function scramblePositions<
  T extends { accountId: string; price?: number; marketValue: number; costBasis?: number }
>(positions: T[]): T[] {
  return positions.map((position) => ({
    ...position,
    costBasis: position.costBasis === undefined ? undefined : scrambleAmount(position.costBasis, position.accountId),
    marketValue: scrambleAmount(position.marketValue, position.accountId),
    price: position.price === undefined ? undefined : scrambleAmount(position.price, position.accountId)
  }));
}
