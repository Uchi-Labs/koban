import type {
  Account,
  AccountGroup,
  Category,
  DashboardSummary,
  ProviderConnection,
  RecurringItem,
  Transaction
} from "@ai-finances/schema";
import { unstable_noStore as noStore } from "next/cache";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyInclusionOverrides, applyNameOverrides, getAccountInclusionOverrides, getAccountNameOverrides } from "@/lib/account-overlays";
import { displayCurrencyCode } from "@/lib/currency";
import {
  buildDemoFactors,
  isDemoModeEnabled,
  scrambleAccounts,
  scrambleBalanceSnapshots,
  scrambleTransactions
} from "@/lib/demo-mode";
import {
  consumeFinanceDbRecoveryEvent,
  financeDbExists,
  listCategories,
  readFinanceDbSnapshot,
  readShellSnapshot,
  replaceLedgerInDb,
  updateDbTransaction
} from "@/lib/db/finance-db";
import {
  internalAmountSignConvention,
  type LedgerAmountNormalization
} from "@/lib/ledger-normalization";
import { isIncomeTransaction, isReviewActionableTransaction, isSpendingTransaction } from "@/lib/transaction-classification";
import { findWorkspaceRoot, readWorkspaceEnv } from "@/lib/workspace-env";

export interface FinanceData {
  source: "empty" | "koban";
  accounts: Account[];
  accountGroups: AccountGroup[];
  categories: Category[];
  dashboardSummary: DashboardSummary;
  providerConnections: ProviderConnection[];
  recurringItems: RecurringItem[];
  transactions: Transaction[];
  ledger?: Ledger;
}

export interface Ledger {
  source: "koban";
  version: 1;
  lastSyncedAt: string;
  syncStartDate: string;
  enrollmentCount: number;
  accounts: Account[];
  balanceSnapshots?: AccountBalanceSnapshot[];
  transactions: Transaction[];
  providerConnections: ProviderConnection[];
  normalization?: LedgerAmountNormalization;
  syncSummary: {
    accountCount: number;
    transactionCount: number;
    errors: string[];
  };
}

export interface AccountBalanceSnapshot {
  id: string;
  accountId: string;
  asOfDate: string;
  capturedAt: string;
  ledgerBalance: number;
  availableBalance?: number;
  currency: string;
  source: string;
}

export interface ShellData {
  accounts: Account[];
  accountGroups: AccountGroup[];
  demoMode: boolean;
  lastSyncedAt?: string;
  reviewActionableCount: number;
  source: "empty" | "koban";
  transactionCount: number;
}

let loggedReadPathNormalizationMigration = false;
let readPathNormalizationMigrationScheduled = false;
let shellDataCache: { expiresAt: number; value: ShellData } | null = null;

// Full-ledger read cache (REAL values only — inclusion overrides and demo
// scrambling are applied per-request downstream). Same TTL + invalidation
// sites as the shell cache: every ledger write path already calls
// invalidateShellDataCache(), which clears both.
let ledgerReadCache: {
  categories: Awaited<ReturnType<typeof listCategories>>;
  expiresAt: number;
  ledger: Ledger;
} | null = null;

const shellDataCacheTtlMs = 30_000;

export function invalidateShellDataCache(): void {
  shellDataCache = null;
  ledgerReadCache = null;
}

// Light read for the app shell: accounts and counts only. The full ledger read
// stays in getFinanceData for pages that need it.
export async function getShellData(): Promise<ShellData> {
  noStore();

  // The cache holds real values; demo scrambling is applied per-request on the
  // way out so toggling the cookie never leaks between requests.
  const demoMode = await isDemoModeEnabled();
  const now = Date.now();
  if (shellDataCache && shellDataCache.expiresAt > now) {
    return demoScrambleShellData(await applyShellOverrides(shellDataCache.value), demoMode);
  }

  const snapshot = await readShellSnapshot();
  if (!snapshot) {
    const value = {
      accounts: [],
      accountGroups: [],
      demoMode: false,
      reviewActionableCount: 0,
      source: "empty" as const,
      transactionCount: 0
    };
    shellDataCache = { expiresAt: now + shellDataCacheTtlMs, value };
    return demoScrambleShellData(await applyShellOverrides(value), demoMode);
  }

  const value = {
    accounts: snapshot.accounts,
    accountGroups: createAccountGroups(snapshot.accounts),
    demoMode: false,
    lastSyncedAt: snapshot.lastSyncedAt,
    reviewActionableCount: snapshot.reviewActionableCount,
    source: "koban" as const,
    transactionCount: snapshot.transactionCount
  };
  shellDataCache = { expiresAt: now + shellDataCacheTtlMs, value };
  return demoScrambleShellData(await applyShellOverrides(value), demoMode);
}

// User overlays (rename, net-worth inclusion) are applied per-request on the
// way out — like demo scrambling — so an edit reflects in the sidebar
// immediately instead of waiting on the 30s shell cache. The cache holds raw
// provider values; overrides never bake into it.
async function applyShellOverrides(value: ShellData): Promise<ShellData> {
  const [inclusion, names] = await Promise.all([getAccountInclusionOverrides(), getAccountNameOverrides()]);
  if (Object.keys(inclusion).length === 0 && Object.keys(names).length === 0) {
    return value;
  }
  let accounts = value.accounts;
  if (Object.keys(inclusion).length > 0) accounts = applyInclusionOverrides(accounts, inclusion);
  if (Object.keys(names).length > 0) accounts = applyNameOverrides(accounts, names);
  return { ...value, accounts, accountGroups: createAccountGroups(accounts) };
}

function demoScrambleShellData(value: ShellData, demoMode: boolean): ShellData {
  if (!demoMode) {
    return value;
  }

  const accounts = scrambleAccounts(value.accounts, buildDemoFactors(value.accounts));
  return { ...value, accounts, accountGroups: createAccountGroups(accounts), demoMode: true };
}

export async function getFinanceData(): Promise<FinanceData> {
  noStore();

  const cachedRead = ledgerReadCache;
  if (cachedRead && cachedRead.expiresAt > Date.now()) {
    return createFinanceDataFromLedger(await withInclusionOverrides(cachedRead.ledger), cachedRead.categories);
  }

  const [categories, financeDbLedger] = await Promise.all([
    listCategories({ includeArchived: true }),
    getFinanceDbLedger()
  ]);
  if (financeDbLedger && financeDbLedger.accounts.length > 0) {
    ledgerReadCache = { categories, expiresAt: Date.now() + shellDataCacheTtlMs, ledger: financeDbLedger };
    scheduleReadPathNormalizationMigration(financeDbLedger);
    return createFinanceDataFromLedger(await withInclusionOverrides(financeDbLedger), categories);
  }

  if (consumeFinanceDbRecoveryEvent()) {
    const restored = await importLedgerBackupFile();

    if (restored && restored.accounts.length > 0) {
      return createFinanceDataFromLedger(await withInclusionOverrides(restored), categories);
    }
  }

  return {
    source: "empty",
    accounts: [],
    accountGroups: [],
    categories,
    dashboardSummary: createDashboardSummary({
      accounts: [],
      accountGroups: [],
      categories,
      transactions: [],
      recurringItems: [],
      providerConnections: [],
      asOf: new Date().toISOString()
    }),
    providerConnections: [],
    recurringItems: [],
    transactions: []
  };
}

export function getLedgerBackupPath(): string {
  const env = readWorkspaceEnv();
  if (env.AI_FINANCES_LEDGER_BACKUP_PATH) {
    return env.AI_FINANCES_LEDGER_BACKUP_PATH;
  }

  return path.join(findWorkspaceRoot(), "data", "local", "ledger.json");
}

function readLedgerBackup(): Ledger | null {
  const ledgerPath = getLedgerBackupPath();

  if (!existsSync(ledgerPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown;

    if (!isLedger(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeLedgerBackup(ledger: Ledger): void {
  const ledgerPath = getLedgerBackupPath();
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

export async function exportLedgerBackup(): Promise<Ledger | null> {
  const ledger = await readFinanceDbSnapshot();

  if (!ledger || ledger.accounts.length === 0) {
    return null;
  }

  writeLedgerBackup(ledger);
  return ledger;
}

export async function importLedgerBackup(ledger: Ledger): Promise<Ledger | null> {
  if (!isLedger(ledger)) {
    return null;
  }

  await replaceLedgerInDb(ledger);
  return (await readFinanceDbSnapshot()) ?? ledger;
}

export async function importLedgerBackupFile(): Promise<Ledger | null> {
  const ledger = readLedgerBackup();
  return ledger ? importLedgerBackup(ledger) : null;
}

export async function updateStoredTransactionInDb(
  transactionId: string,
  update: Partial<Pick<Transaction, "categoryId" | "notes" | "reviewed" | "tags">>
): Promise<Transaction | null> {
  return updateDbTransaction(transactionId, update);
}

async function withInclusionOverrides(ledger: Ledger): Promise<Ledger> {
  const [overrides, nameOverrides] = await Promise.all([getAccountInclusionOverrides(), getAccountNameOverrides()]);
  let accounts = ledger.accounts;
  if (Object.keys(overrides).length > 0) accounts = applyInclusionOverrides(accounts, overrides);
  if (Object.keys(nameOverrides).length > 0) accounts = applyNameOverrides(accounts, nameOverrides);
  const withOverrides = accounts === ledger.accounts ? ledger : { ...ledger, accounts };

  if (!(await isDemoModeEnabled())) {
    return withOverrides;
  }

  const factors = buildDemoFactors(withOverrides.accounts);
  return {
    ...withOverrides,
    accounts: scrambleAccounts(withOverrides.accounts, factors),
    balanceSnapshots: withOverrides.balanceSnapshots
      ? scrambleBalanceSnapshots(withOverrides.balanceSnapshots, factors)
      : withOverrides.balanceSnapshots,
    transactions: scrambleTransactions(withOverrides.transactions)
  };
}

function createFinanceDataFromLedger(ledger: Ledger, categories: Category[]): FinanceData {
  const accountGroups = createAccountGroups(ledger.accounts);

  // recurringItems and dashboardSummary are each a full O(n) pass over every
  // transaction (recurring detection also groups and sorts per merchant), but
  // most routes never read them -- /transactions, /review, /rules and /search
  // only want accounts, categories and transactions. Computing them lazily,
  // memoized per FinanceData object, keeps those routes off the work entirely
  // while callers that do read the fields see no behaviour change.
  const metricTransactions = memoize(() => filterTransactionsForIncludedAccounts(ledger.accounts, ledger.transactions));
  const recurringItems = memoize(() => createRecurringItems(metricTransactions()));
  const dashboardSummary = memoize(() => createDashboardSummary({
    accounts: ledger.accounts,
    accountGroups,
    categories,
    transactions: metricTransactions(),
    recurringItems: recurringItems(),
    providerConnections: ledger.providerConnections,
    asOf: ledger.lastSyncedAt
  }));

  return {
    source: "koban",
    accounts: ledger.accounts,
    accountGroups,
    categories,
    get dashboardSummary() {
      return dashboardSummary();
    },
    providerConnections: ledger.providerConnections,
    get recurringItems() {
      return recurringItems();
    },
    transactions: ledger.transactions,
    ledger
  };
}

function memoize<T>(compute: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => {
    cached ??= { value: compute() };
    return cached.value;
  };
}

async function getFinanceDbLedger(): Promise<Ledger | null> {
  if (!financeDbExists()) {
    return null;
  }

  return readFinanceDbSnapshot();
}

function scheduleReadPathNormalizationMigration(ledger: Ledger): void {
  if (ledger.normalization?.amountSignConvention === internalAmountSignConvention) {
    return;
  }

  if (!loggedReadPathNormalizationMigration) {
    loggedReadPathNormalizationMigration = true;
    console.warn("Finance DB snapshot uses an old amount convention; scheduling background normalization.");
  }

  if (readPathNormalizationMigrationScheduled) {
    return;
  }

  readPathNormalizationMigrationScheduled = true;
  void replaceLedgerInDb(ledger)
    .catch((error) => {
      console.error(
        error instanceof Error
          ? `Background ledger normalization failed: ${error.message}`
          : "Background ledger normalization failed."
      );
    })
    .finally(() => {
      readPathNormalizationMigrationScheduled = false;
    });
}

function isLedger(value: unknown): value is Ledger {
  const parsed = value as Partial<Ledger>;

  return (
    parsed.source === "koban" &&
    parsed.version === 1 &&
    typeof parsed.lastSyncedAt === "string" &&
    typeof parsed.syncStartDate === "string" &&
    typeof parsed.enrollmentCount === "number" &&
    Array.isArray(parsed.accounts) &&
    Array.isArray(parsed.transactions) &&
    Array.isArray(parsed.providerConnections) &&
    typeof parsed.syncSummary === "object" &&
    parsed.syncSummary !== null
  );
}

export function createAccountGroups(accounts: Account[]): AccountGroup[] {
  const groupSpecs: Array<{ id: string; name: string; types: Account["type"][]; sortOrder: number }> = [
    { id: "group_cash", name: "Cash", types: ["cash", "checking", "savings"], sortOrder: 10 },
    { id: "group_credit", name: "Credit cards", types: ["credit_card"], sortOrder: 20 },
    { id: "group_investments", name: "Investments", types: ["investment"], sortOrder: 30 },
    { id: "group_other", name: "Other", types: ["loan"], sortOrder: 40 }
  ];

  return groupSpecs.flatMap((group) => {
    const groupAccounts = accounts.filter((account) => group.types.includes(account.type));
    const includedGroupAccounts = groupAccounts.filter((account) => account.includedInNetWorth);

    if (includedGroupAccounts.length === 0) {
      return [];
    }

    return [
      {
        id: group.id,
        name: group.name,
        accountIds: includedGroupAccounts.map((account) => account.id),
        currency: displayCurrencyCode(includedGroupAccounts.map((account) => account.currency)),
        totalBalance: sum(includedGroupAccounts.map((account) => account.currentBalance)),
        includedInNetWorth: true,
        sortOrder: group.sortOrder
      } satisfies AccountGroup
    ];
  });
}

export function getAccountNetWorthContribution(account: Account): number {
  if (!account.includedInNetWorth) {
    return 0;
  }

  if (account.type === "credit_card" || account.type === "loan") {
    return -Math.abs(account.currentBalance);
  }

  return account.currentBalance;
}

export function createDashboardSummary({
  accounts,
  accountGroups,
  categories,
  transactions,
  recurringItems,
  providerConnections,
  asOf
}: {
  accounts: Account[];
  accountGroups: AccountGroup[];
  categories?: Category[];
  transactions: Transaction[];
  recurringItems: RecurringItem[];
  providerConnections: ProviderConnection[];
  asOf: string;
}): DashboardSummary {
  const metricTransactions = filterTransactionsForIncludedAccounts(accounts, transactions);
  const monthKey = getSummaryMonth(metricTransactions);
  const monthTransactions = metricTransactions.filter((transaction) => transaction.date.startsWith(monthKey));
  const spendingByCategory = new Map<string, { amount: number; transactionCount: number; budgetAmount?: number }>();
  const categoryById = new Map((categories ?? []).map((category) => [category.id, category]));

  for (const transaction of monthTransactions) {
    if (!isSpendingTransaction(transaction)) {
      continue;
    }

    const existing = spendingByCategory.get(transaction.categoryId) ?? { amount: 0, transactionCount: 0 };
    existing.amount += transaction.amount;
    existing.transactionCount += 1;
    existing.budgetAmount = categoryById.get(transaction.categoryId)?.budgetAmount;
    spendingByCategory.set(transaction.categoryId, existing);
  }

  return {
    asOf,
    currency: displayCurrencyCode([...accounts.map((account) => account.currency), ...monthTransactions.map((transaction) => transaction.currency)]),
    netWorth: sum(accounts.map(getAccountNetWorthContribution)),
    cashBalance: sum(accountGroups.filter((group) => group.id === "group_cash").map((group) => group.totalBalance)),
    creditBalance: sum(accountGroups.filter((group) => group.id === "group_credit").map((group) => group.totalBalance)),
    monthlyIncome: sum(monthTransactions.filter(isIncomeTransaction).map((transaction) => transaction.amount)),
    monthlySpending: sum(monthTransactions.filter(isSpendingTransaction).map((transaction) => transaction.amount)),
    transactionsToReview: metricTransactions.filter(isReviewActionableTransaction).length,
    pendingTransactionCount: metricTransactions.filter((transaction) => transaction.status === "pending").length,
    topCategories: Array.from(spendingByCategory.entries())
      .map(([categoryId, summary]) => ({ categoryId, ...summary, amount: roundMoney(summary.amount) }))
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
      .slice(0, 5),
    upcomingRecurringIds: recurringItems.slice(0, 5).map((item) => item.id),
    providerConnectionIds: providerConnections.map((connection) => connection.id)
  };
}

export function createRecurringItems(transactions: Transaction[]): RecurringItem[] {
  const groups = new Map<string, Transaction[]>();
  let latestDataDate = "";

  for (const transaction of transactions) {
    if (!isSpendingTransaction(transaction) || transaction.status !== "posted") {
      continue;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(transaction.date) && transaction.date > latestDataDate) {
      latestDataDate = transaction.date;
    }

    const key = `${transaction.accountId}:${normalizeMerchantKey(transaction.merchantName)}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  return Array.from(groups.entries())
    .flatMap(([key, groupTransactions]) => {
      const datedTransactions = groupTransactions
        .filter((transaction) => /^\d{4}-\d{2}-\d{2}$/.test(transaction.date))
        .sort((left, right) => left.date.localeCompare(right.date));

      if (datedTransactions.length < 3) {
        return [];
      }

      const gaps = datedTransactions
        .slice(1)
        .map((transaction, index) => daysBetween(datedTransactions[index].date, transaction.date))
        .filter((gap) => Number.isFinite(gap) && gap > 0);

      if (gaps.length < 2) {
        return [];
      }

      const medianGap = median(gaps);
      const cadence = cadenceFromGap(medianGap);
      const lastTransaction = datedTransactions.at(-1);

      if (!lastTransaction) {
        return [];
      }

      // Regularity gate: subscriptions charge on a steady beat. Frequent-but-random
      // merchants (Amazon, groceries) produce a plausible *median* gap while the
      // individual gaps scatter — require most gaps to sit near the cadence period.
      const cadenceDays = cadenceToDays(cadence);
      const gapTolerance = cadenceGapTolerance(cadence);
      const regularGaps = gaps.filter((gap) => Math.abs(gap - cadenceDays) <= gapTolerance);
      if (regularGaps.length / gaps.length < 0.7) {
        return [];
      }

      // Short cadences need more evidence: two coincidental week-apart purchases
      // must not mint a "weekly" subscription.
      if ((cadence === "weekly" || cadence === "biweekly") && gaps.length < 3) {
        return [];
      }

      // Amount gate: subscription charges cluster around one price (price hikes
      // allowed); variable spending scatters.
      const amounts = datedTransactions.map((transaction) => Math.abs(transaction.amount));
      const medianAmount = median(amounts);
      if (medianAmount <= 0) {
        return [];
      }
      const amountTolerance = Math.max(3, medianAmount * 0.3);
      const consistentAmounts = amounts.filter((amount) => Math.abs(amount - medianAmount) <= amountTolerance);
      if (consistentAmounts.length / amounts.length < 0.7) {
        return [];
      }

      // Recency gate: a merchant that missed two straight cycles is cancelled, not due.
      if (latestDataDate && daysBetween(lastTransaction.date, latestDataDate) > cadenceDays * 2 + gapTolerance) {
        return [];
      }

      // Median, not mean: robust to the occasional off-price charge inside the gate.
      const averageAmount = medianAmount;
      const categoryId = mostCommon(datedTransactions.map((transaction) => transaction.categoryId)) ?? "cat_other";

      return [
        {
          id: `recurring_${hashId(key)}`,
          name: lastTransaction.merchantName,
          categoryId,
          accountId: lastTransaction.accountId,
          cadence,
          amount: -roundMoney(averageAmount),
          averageAmount: roundMoney(averageAmount),
          currency: displayCurrencyCode(datedTransactions.map((transaction) => transaction.currency)),
          nextDate: addDays(lastTransaction.date, cadenceDays),
          lastChargedAt: lastTransaction.date,
          status: "watching"
        } satisfies RecurringItem
      ];
    })
    .sort((left, right) => {
      const leftLastCharged = left.lastChargedAt ?? "";
      const rightLastCharged = right.lastChargedAt ?? "";
      return rightLastCharged.localeCompare(leftLastCharged) || Math.abs(right.averageAmount) - Math.abs(left.averageAmount);
    })
    .slice(0, 20);
}

export function filterTransactionsForIncludedAccounts(accounts: Account[], transactions: Transaction[]): Transaction[] {
  const includedAccountIds = new Set(accounts.filter((account) => account.includedInNetWorth).map((account) => account.id));

  if (includedAccountIds.size === accounts.length) {
    return transactions;
  }

  return transactions.filter((transaction) => includedAccountIds.has(transaction.accountId));
}

function getSummaryMonth(transactions: Transaction[]): string {
  // Single max scan: copying every date into a new array and sorting it is
  // O(n log n) plus an n-length allocation to read one value.
  let latestDate: string | undefined;
  for (const transaction of transactions) {
    if (latestDate === undefined || transaction.date > latestDate) {
      latestDate = transaction.date;
    }
  }

  return (latestDate ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
}

function sum(values: number[]): number {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

function normalizeMerchantKey(merchant: string): string {
  return merchant.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function daysBetween(leftDate: string, rightDate: string): number {
  const left = Date.parse(`${leftDate}T12:00:00Z`);
  const right = Date.parse(`${rightDate}T12:00:00Z`);
  return Math.round((right - left) / 86_400_000);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 30;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function cadenceFromGap(days: number): RecurringItem["cadence"] {
  if (days <= 10) {
    return "weekly";
  }

  if (days <= 20) {
    return "biweekly";
  }

  if (days <= 45) {
    return "monthly";
  }

  if (days <= 120) {
    return "quarterly";
  }

  return "annual";
}

function cadenceGapTolerance(cadence: RecurringItem["cadence"]): number {
  switch (cadence) {
    case "weekly":
      return 2;
    case "biweekly":
      return 3;
    case "monthly":
      return 5;
    case "quarterly":
      return 12;
    case "annual":
      return 20;
  }
}

function cadenceToDays(cadence: RecurringItem["cadence"]): number {
  switch (cadence) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
    case "quarterly":
      return 91;
    case "annual":
      return 365;
  }
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
}

function hashId(value: string): string {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
