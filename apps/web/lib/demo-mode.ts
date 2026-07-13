// Demo mode: deterministic scrambling of money figures and account identity for
// screenshots/demos.
//
// Balances are magnitude-squashed (|v|^0.8 × jitter) so a six-figure portfolio
// demos as a modest five-figure one; an account's balance history and market
// values share the account's linear factor so charts keep their shapes. Position price, units,
// and cost basis are recomputed into a coherent synthetic lot so real returns
// never survive the display boundary. Transaction amounts get a mild per-merchant
// factor instead (a $13 subscription should still look like a subscription, not
// $2). Account and institution names are swapped for a generic pool; masks are
// re-rolled. Applied only at display-read boundaries (getFinanceData /
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Magnitude squash: |v|^0.8 × jitter(0.75–1.35), sign preserved.
 * $276,818 → ~$17–30K · $7,849 → ~$1–1.8K · $203 → ~$52–95.
 */
export function squashAmount(value: number, seed: string): number {
  if (value === 0) {
    return 0;
  }
  const jitter = 0.75 + hash01(`koban-demo:${seed}`) * 0.6;
  return round2(Math.sign(value) * Math.pow(Math.abs(value), 0.8) * jitter);
}

/** Linear factor that maps an account's real balance onto its squashed one. */
export function accountDemoFactor(account: { currentBalance: number; id: string }): number {
  const magnitude = Math.abs(account.currentBalance);
  if (magnitude < 1) {
    return 0.75 + hash01(`koban-demo:${account.id}`) * 0.6;
  }
  return Math.abs(squashAmount(account.currentBalance, account.id)) / magnitude;
}

export function buildDemoFactors(accounts: Array<{ currentBalance: number; id: string }>): Map<string, number> {
  return new Map(accounts.map((account) => [account.id, accountDemoFactor(account)]));
}

/** Mild per-merchant factor (0.5–1.2) — transaction amounts stay life-sized. */
export function scrambleTransactions<T extends { amount: number; merchantName?: string; accountId: string }>(
  transactions: T[]
): T[] {
  return transactions.map((transaction) => {
    const factor = 0.5 + hash01(`koban-demo-merchant:${transaction.merchantName ?? transaction.accountId}`) * 0.7;
    return { ...transaction, amount: round2(transaction.amount * factor) };
  });
}

export function scrambleMask(mask: string | undefined, seed: string): string | undefined {
  return mask ? String(Math.floor(1000 + hash01(`koban-demo-mask:${seed}`) * 9000)) : mask;
}

// Two-part procedural institutions (200 combos) keep collisions unlikely even
// with many linked providers; a fixed pool of six collided constantly.
const INSTITUTION_PREFIXES = [
  "North",
  "Bluepeak",
  "Summit",
  "Juniper",
  "Harbor",
  "Cedar",
  "Lakeside",
  "Beacon",
  "Granite",
  "Silver Oak",
  "Redwood",
  "Prairie",
  "Atlas",
  "Meridian",
  "Frontier",
  "Cascade",
  "Pioneer",
  "Sterling",
  "Compass",
  "Alder"
];

const INSTITUTION_SUFFIXES = [
  "Bank",
  "Trust",
  "Credit Union",
  "Financial",
  "Savings",
  "Bancorp",
  "Federal",
  "Capital",
  "Mutual",
  "Partners"
];

const DEMO_ACCOUNT_NAMES: Record<string, string[]> = {
  cash: ["Cash", "Wallet"],
  checking: [
    "Everyday Checking",
    "Household Checking",
    "Main Checking",
    "Joint Checking",
    "Direct Checking",
    "Bills Checking"
  ],
  savings: [
    "Rainy Day Savings",
    "Vacation Fund",
    "High-Yield Savings",
    "Emergency Fund",
    "House Fund",
    "Holiday Savings"
  ],
  credit_card: ["Cashback Card", "Travel Card", "Rewards Card", "Everyday Card", "Dining Card", "Online Card"],
  investment: [
    "Brokerage",
    "Retirement",
    "Roth IRA",
    "Index Portfolio",
    "Growth Account",
    "Dividend Portfolio",
    "College Fund",
    "Long-Term Holdings"
  ],
  loan: ["Auto Loan", "Student Loan", "Personal Loan", "Home Loan"]
};

function pick<T>(pool: T[], seed: string): T {
  return pool[Math.floor(hash01(`koban-demo-pick:${seed}`) * pool.length) % pool.length];
}

/** Same real institution always maps to the same fake one, so grouping stays coherent. */
export function scrambleInstitutionName(institutionName: string): string {
  return `${pick(INSTITUTION_PREFIXES, `inst-prefix:${institutionName}`)} ${pick(INSTITUTION_SUFFIXES, `inst-suffix:${institutionName}`)}`;
}

export function scrambleAccountName(type: string, accountId: string): string {
  return pick(DEMO_ACCOUNT_NAMES[type] ?? DEMO_ACCOUNT_NAMES.checking, `name:${accountId}`);
}

export function scrambleAccounts<
  T extends {
    id: string;
    name: string;
    institutionName: string;
    type: string;
    currentBalance: number;
    availableBalance?: number;
    mask?: string;
  }
>(accounts: T[], factors: Map<string, number>): T[] {
  return accounts.map((account) => {
    const factor = factors.get(account.id) ?? 1;
    return {
      ...account,
      availableBalance:
        account.availableBalance === undefined ? undefined : round2(account.availableBalance * factor),
      currentBalance: round2(account.currentBalance * factor),
      institutionName: scrambleInstitutionName(account.institutionName),
      mask: scrambleMask(account.mask, account.id),
      name: scrambleAccountName(account.type, account.id)
    };
  });
}

export function scrambleBalanceSnapshots<
  T extends { accountId: string; ledgerBalance: number; availableBalance?: number }
>(snapshots: T[], factors: Map<string, number>): T[] {
  return snapshots.map((snapshot) => {
    const factor = factors.get(snapshot.accountId) ?? 1;
    return {
      ...snapshot,
      availableBalance:
        snapshot.availableBalance === undefined ? undefined : round2(snapshot.availableBalance * factor),
      ledgerBalance: round2(snapshot.ledgerBalance * factor)
    };
  });
}

/** Recompute each holding into a deterministic synthetic lot with coherent price × units and a private return. */
export function scramblePositions<
  T extends {
    accountId: string;
    costBasis?: number;
    id?: string;
    marketValue: number;
    price?: number;
    units: number;
  }
>(
  positions: T[],
  factors: Map<string, number>
): T[] {
  return positions.map((position) => {
    const factor = factors.get(position.accountId) ?? 1;
    const seed = position.id ?? `${position.accountId}:${position.units}:${position.marketValue}`;
    const marketValue = round2(position.marketValue * factor);
    const priceFactor = 0.65 + hash01(`koban-demo-position-price:${seed}`) * 0.25;
    const fallbackPrice = position.units === 0 ? 0 : position.marketValue / position.units;
    const sourcePrice = position.price && Number.isFinite(position.price) ? position.price : fallbackPrice;
    const price = position.price === undefined ? undefined : round6(sourcePrice * priceFactor);
    const units = price && Number.isFinite(price)
      ? Math.round((marketValue / price) * 10000) / 10000
      : Math.round(position.units * factor * 10000) / 10000;
    const costBasis = syntheticCostBasis(position, { marketValue, seed, units });

    return {
      ...position,
      costBasis,
      marketValue,
      price,
      units
    };
  });
}

function syntheticCostBasis(
  position: { costBasis?: number; marketValue: number; units: number },
  scrambled: { marketValue: number; seed: string; units: number }
): number | undefined {
  if (position.costBasis === undefined || scrambled.units === 0) {
    return undefined;
  }

  const realCostBasisValue = position.costBasis * position.units;
  const realReturn = realCostBasisValue === 0
    ? 0
    : (position.marketValue - realCostBasisValue) / Math.abs(realCostBasisValue);
  let syntheticReturn = -0.15 + hash01(`koban-demo-position-return:${scrambled.seed}`) * 0.5;
  if (Math.abs(syntheticReturn - realReturn) < 0.05) {
    syntheticReturn += syntheticReturn > 0.1 ? -0.1 : 0.1;
  }

  const syntheticCostBasisValue = scrambled.marketValue / (1 + syntheticReturn);
  return round6(syntheticCostBasisValue / scrambled.units);
}
