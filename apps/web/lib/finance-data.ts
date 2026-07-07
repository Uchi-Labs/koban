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
import { displayCurrencyCode } from "@/lib/currency";
import {
  consumeFinanceDbRecoveryEvent,
  financeDbExists,
  listCategories,
  readFinanceDbSnapshot,
  readShellSnapshot,
  replaceTellerLedgerInDb,
  updateDbTransaction
} from "@/lib/db/finance-db";
import {
  tellerInternalAmountSignConvention,
  type TellerLedgerAmountNormalization
} from "@/lib/teller-normalization";
import { isIncomeTransaction, isReviewActionableTransaction, isSpendingTransaction } from "@/lib/transaction-classification";
import { findWorkspaceRoot, readWorkspaceEnv } from "@/lib/workspace-env";

export interface FinanceData {
  source: "empty" | "teller";
  accounts: Account[];
  accountGroups: AccountGroup[];
  categories: Category[];
  dashboardSummary: DashboardSummary;
  providerConnections: ProviderConnection[];
  recurringItems: RecurringItem[];
  transactions: Transaction[];
  tellerLedger?: TellerLedger;
}

export interface TellerLedger {
  source: "teller";
  version: 1;
  lastSyncedAt: string;
  syncStartDate: string;
  enrollmentCount: number;
  accounts: Account[];
  balanceSnapshots?: AccountBalanceSnapshot[];
  transactions: Transaction[];
  providerConnections: ProviderConnection[];
  normalization?: TellerLedgerAmountNormalization;
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
  lastSyncedAt?: string;
  reviewActionableCount: number;
  source: "empty" | "teller";
  transactionCount: number;
}

let loggedReadPathNormalizationMigration = false;
let readPathNormalizationMigrationScheduled = false;
let shellDataCache: { expiresAt: number; value: ShellData } | null = null;

const shellDataCacheTtlMs = 30_000;

export function invalidateShellDataCache(): void {
  shellDataCache = null;
}

// Light read for the app shell: accounts and counts only. The full ledger read
// stays in getFinanceData for pages that need it.
export async function getShellData(): Promise<ShellData> {
  noStore();

  const now = Date.now();
  if (shellDataCache && shellDataCache.expiresAt > now) {
    return shellDataCache.value;
  }

  const snapshot = await readShellSnapshot();
  if (!snapshot) {
    const value = { accounts: [], accountGroups: [], reviewActionableCount: 0, source: "empty" as const, transactionCount: 0 };
    shellDataCache = { expiresAt: now + shellDataCacheTtlMs, value };
    return value;
  }

  const value = {
    accounts: snapshot.accounts,
    accountGroups: createAccountGroups(snapshot.accounts),
    lastSyncedAt: snapshot.lastSyncedAt,
    reviewActionableCount: snapshot.reviewActionableCount,
    source: "teller" as const,
    transactionCount: snapshot.transactionCount
  };
  shellDataCache = { expiresAt: now + shellDataCacheTtlMs, value };
  return value;
}

export async function getFinanceData(): Promise<FinanceData> {
  noStore();

  const categories = await listCategories({ includeArchived: true });
  const financeDbLedger = await getFinanceDbLedger();
  if (financeDbLedger && financeDbLedger.accounts.length > 0) {
    scheduleReadPathNormalizationMigration(financeDbLedger);
    return createFinanceDataFromLedger(financeDbLedger, categories);
  }

  if (consumeFinanceDbRecoveryEvent()) {
    const restored = await importTellerLedgerBackupFile();

    if (restored && restored.accounts.length > 0) {
      return createFinanceDataFromLedger(restored, categories);
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

export function getTellerLedgerBackupPath(): string {
  const env = readWorkspaceEnv();
  if (env.AI_FINANCES_TELLER_BACKUP_PATH) {
    return env.AI_FINANCES_TELLER_BACKUP_PATH;
  }

  return path.join(findWorkspaceRoot(), "data", "local", "teller-ledger.json");
}

function readTellerLedgerBackup(): TellerLedger | null {
  const ledgerPath = getTellerLedgerBackupPath();

  if (!existsSync(ledgerPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown;

    if (!isTellerLedger(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeTellerLedgerBackup(ledger: TellerLedger): void {
  const ledgerPath = getTellerLedgerBackupPath();
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

export async function exportTellerLedgerBackup(): Promise<TellerLedger | null> {
  const ledger = await readFinanceDbSnapshot();

  if (!ledger || ledger.accounts.length === 0) {
    return null;
  }

  writeTellerLedgerBackup(ledger);
  return ledger;
}

export async function importTellerLedgerBackup(ledger: TellerLedger): Promise<TellerLedger | null> {
  if (!isTellerLedger(ledger)) {
    return null;
  }

  await replaceTellerLedgerInDb(ledger);
  return (await readFinanceDbSnapshot()) ?? ledger;
}

export async function importTellerLedgerBackupFile(): Promise<TellerLedger | null> {
  const ledger = readTellerLedgerBackup();
  return ledger ? importTellerLedgerBackup(ledger) : null;
}

export async function updateStoredTransactionInDb(
  transactionId: string,
  update: Partial<Pick<Transaction, "categoryId" | "notes" | "reviewed" | "tags">>
): Promise<Transaction | null> {
  return updateDbTransaction(transactionId, update);
}

function createFinanceDataFromLedger(tellerLedger: TellerLedger, categories: Category[]): FinanceData {
  const accountGroups = createAccountGroups(tellerLedger.accounts);
  const metricTransactions = filterTransactionsForIncludedAccounts(tellerLedger.accounts, tellerLedger.transactions);
  const recurringItems = createRecurringItems(metricTransactions);
  const dashboardSummary = createDashboardSummary({
    accounts: tellerLedger.accounts,
    accountGroups,
    categories,
    transactions: metricTransactions,
    recurringItems,
    providerConnections: tellerLedger.providerConnections,
    asOf: tellerLedger.lastSyncedAt
  });

  return {
    source: "teller",
    accounts: tellerLedger.accounts,
    accountGroups,
    categories,
    dashboardSummary,
    providerConnections: tellerLedger.providerConnections,
    recurringItems,
    transactions: tellerLedger.transactions,
    tellerLedger
  };
}

async function getFinanceDbLedger(): Promise<TellerLedger | null> {
  if (!financeDbExists()) {
    return null;
  }

  return readFinanceDbSnapshot();
}

function scheduleReadPathNormalizationMigration(ledger: TellerLedger): void {
  if (ledger.normalization?.amountSignConvention === tellerInternalAmountSignConvention) {
    return;
  }

  if (!loggedReadPathNormalizationMigration) {
    loggedReadPathNormalizationMigration = true;
    console.warn("Finance DB snapshot uses an old Teller amount convention; scheduling background normalization.");
  }

  if (readPathNormalizationMigrationScheduled) {
    return;
  }

  readPathNormalizationMigrationScheduled = true;
  void replaceTellerLedgerInDb(ledger)
    .catch((error) => {
      console.error(
        error instanceof Error
          ? `Background Teller normalization failed: ${error.message}`
          : "Background Teller normalization failed."
      );
    })
    .finally(() => {
      readPathNormalizationMigrationScheduled = false;
    });
}

function isTellerLedger(value: unknown): value is TellerLedger {
  const parsed = value as Partial<TellerLedger>;

  return (
    parsed.source === "teller" &&
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

  for (const transaction of transactions) {
    if (!isSpendingTransaction(transaction) || transaction.status !== "posted") {
      continue;
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
      const medianGap = median(gaps);
      const cadence = cadenceFromGap(medianGap);
      const lastTransaction = datedTransactions.at(-1);

      if (!lastTransaction) {
        return [];
      }

      const averageAmount =
        datedTransactions.reduce((total, transaction) => total + Math.abs(transaction.amount), 0) / datedTransactions.length;
      const categoryId = mostCommon(datedTransactions.map((transaction) => transaction.categoryId)) ?? "cat_other";
      const cadenceDays = cadenceToDays(cadence);

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
  const latestDate = transactions
    .map((transaction) => transaction.date)
    .sort()
    .at(-1);

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
