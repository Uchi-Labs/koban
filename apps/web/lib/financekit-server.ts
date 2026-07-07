import { createHash } from "node:crypto";
import type { Account, AccountType, ProviderConnection, Transaction } from "@ai-finances/schema";
import type { JsonObject } from "@/lib/api-request";
import { normalizeProviderCurrencyCode } from "@/lib/currency";
import {
  ingestFinanceKitLedgerSnapshot,
  listConnectionInventory,
  readFinanceDbSnapshot,
  readSyncStateValue,
  recordAppSyncRun
} from "@/lib/db/finance-db";
import type { AccountBalanceSnapshot } from "@/lib/finance-data";
import { invalidateShellDataCache } from "@/lib/finance-data";
import { mapProviderTransactionCategory } from "@/lib/provider-transaction-category";

export type FinanceKitAccountKind = "asset" | "credit";
export type FinanceKitCreditDebit = "credit" | "debit";

export interface FinanceKitIngestAccount {
  balance?: number;
  balanceAsOf?: string;
  currency: string;
  displayName: string;
  id: string;
  institutionName?: string;
  type: FinanceKitAccountKind;
}

export interface FinanceKitIngestTransaction {
  accountId: string;
  amount?: number;
  amountMinor?: number;
  creditDebit: FinanceKitCreditDebit;
  currency: string;
  description?: string;
  id: string;
  merchantName?: string;
  pending: boolean;
  postedDate: string;
}

export interface FinanceKitIngestInput {
  accounts: FinanceKitIngestAccount[];
  deviceName?: string;
  transactions: FinanceKitIngestTransaction[];
}

export interface FinanceKitMappedIngest {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  providerConnection: ProviderConnection;
  transactions: Transaction[];
}

export interface FinanceKitIngestResult {
  accountsUpserted: number;
  appSyncRunId: string;
  lastIngestedAt: string;
  transactionsAdded: number;
  transactionsUnchanged: number;
  transactionsUpdated: number;
}

export interface FinanceKitSetupStatus {
  configured: boolean;
  endpointPath: string;
  lastIngestedAt?: string;
  providerConnectionCount: number;
  storedAccountCount: number;
  storedTransactionCount: number;
}

export class FinanceKitIngestError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export const financeKitLastIngestedStateKey = "financekit_last_ingested_at";
export const financeKitProviderConnectionId = "provider_financekit";
const financeKitIngestPath = "/api/v1/financekit/ingest";

type ParseResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      error: string;
      ok: false;
    };

export async function getFinanceKitSetupStatus(): Promise<FinanceKitSetupStatus> {
  const [snapshot, inventory, lastIngestedAt] = await Promise.all([
    readFinanceDbSnapshot(),
    listConnectionInventory(),
    readSyncStateValue(financeKitLastIngestedStateKey)
  ]);
  const financeKitConnections = (snapshot?.providerConnections ?? []).filter(
    (connection) => connection.provider === "financekit"
  );
  const financeKitConnectionIds = new Set(financeKitConnections.map((connection) => connection.id));
  let storedAccountCount = 0;
  let storedTransactionCount = 0;

  for (const account of inventory.accounts) {
    if (inventory.providerByConnection[account.providerConnectionId] === "financekit") {
      storedAccountCount += 1;
    }
  }

  for (const connectionId of financeKitConnectionIds) {
    storedTransactionCount += inventory.transactionCountByConnection[connectionId] ?? 0;
  }

  return {
    configured: true,
    endpointPath: financeKitIngestPath,
    lastIngestedAt:
      lastIngestedAt ??
      latestIso(financeKitConnections.flatMap((connection) => connection.lastSyncedAt ?? [])),
    providerConnectionCount: financeKitConnections.length,
    storedAccountCount,
    storedTransactionCount
  };
}

export async function ingestFinanceKitPayload(
  input: FinanceKitIngestInput,
  now = new Date()
): Promise<FinanceKitIngestResult> {
  const startedAt = now.toISOString();
  const finishedAt = startedAt;
  const mapped = mapFinanceKitIngestToDomain(input, finishedAt);
  const record = await ingestFinanceKitLedgerSnapshot({
    ...mapped,
    deviceName: input.deviceName,
    finishedAt,
    startedAt
  });
  const appSyncRun = await recordAppSyncRun({
    enrichmentStatus: "succeeded",
    enrichmentSummary: { skipped: true },
    financekitStatus: "succeeded",
    financekitSummary: {
      accountCount: mapped.accounts.length,
      accountsUpserted: record.accountsUpserted,
      deviceName: input.deviceName,
      lastIngestedAt: record.lastIngestedAt,
      transactionCount: mapped.transactions.length,
      transactionsAdded: record.transactionsAdded,
      transactionsUnchanged: record.transactionsUnchanged,
      transactionsUpdated: record.transactionsUpdated
    },
    finishedAt,
    plaidStatus: "succeeded",
    plaidSummary: { skipped: true },
    simplefinStatus: "succeeded",
    simplefinSummary: { skipped: true },
    snaptradeStatus: "succeeded",
    snaptradeSummary: { skipped: true },
    sourcesStatus: "succeeded",
    sourcesSummary: { skipped: true },
    startedAt,
    status: "succeeded",
    tellerStatus: "succeeded",
    tellerSummary: { skipped: true }
  });

  invalidateShellDataCache();

  return {
    accountsUpserted: record.accountsUpserted,
    appSyncRunId: appSyncRun.id,
    lastIngestedAt: record.lastIngestedAt,
    transactionsAdded: record.transactionsAdded,
    transactionsUnchanged: record.transactionsUnchanged,
    transactionsUpdated: record.transactionsUpdated
  };
}

export function parseFinanceKitIngestBody(body: JsonObject): ParseResult<FinanceKitIngestInput> {
  const deviceName = optionalCleanString(body.device_name, "device_name");

  if (!deviceName.ok) {
    return parseError(deviceName.error);
  }

  if (!Array.isArray(body.accounts)) {
    return parseError("accounts must be an array.");
  }

  if (!Array.isArray(body.transactions)) {
    return parseError("transactions must be an array.");
  }

  const accounts: FinanceKitIngestAccount[] = [];
  const seenAccountIds = new Set<string>();

  for (let index = 0; index < body.accounts.length; index += 1) {
    const parsed = parseFinanceKitAccount(body.accounts[index], index);

    if (!parsed.ok) {
      return parseError(parsed.error);
    }

    accounts.push(parsed.value);
    seenAccountIds.add(parsed.value.id);
  }

  const transactions: FinanceKitIngestTransaction[] = [];

  for (let index = 0; index < body.transactions.length; index += 1) {
    const parsed = parseFinanceKitTransaction(body.transactions[index], index, seenAccountIds);

    if (!parsed.ok) {
      return parseError(parsed.error);
    }

    transactions.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      accounts: dedupeByRawId(accounts),
      deviceName: parseValue(deviceName),
      transactions: dedupeByRawId(transactions)
    }
  };
}

export function mapFinanceKitIngestToDomain(
  input: FinanceKitIngestInput,
  ingestedAt: string
): FinanceKitMappedIngest {
  const accountByRawId = new Map<string, Account>();
  const balanceSnapshots: AccountBalanceSnapshot[] = [];

  for (const financeKitAccount of input.accounts) {
    const account = mapFinanceKitAccountToDomain(financeKitAccount, ingestedAt);
    accountByRawId.set(financeKitAccount.id, account);

    if (financeKitAccount.balance !== undefined) {
      balanceSnapshots.push(createFinanceKitBalanceSnapshot(account, financeKitAccount, ingestedAt));
    }
  }

  const transactions = input.transactions.flatMap((transaction) => {
    const account = accountByRawId.get(transaction.accountId);
    return account ? [mapFinanceKitTransactionToDomain(transaction, account)] : [];
  });

  return {
    accounts: [...accountByRawId.values()],
    balanceSnapshots,
    providerConnection: {
      configured: true,
      displayName: input.deviceName ? `FinanceKit - ${input.deviceName}` : "FinanceKit",
      id: financeKitProviderConnectionId,
      lastSyncedAt: ingestedAt,
      provider: "financekit",
      status: "connected"
    },
    transactions
  };
}

export function accountIdForFinanceKit(accountId: string): string {
  return `financekit_acct_${stableIdSuffix(accountId)}`;
}

export function transactionIdForFinanceKit(transactionId: string): string {
  return `financekit_txn_${stableIdSuffix(transactionId)}`;
}

function parseFinanceKitAccount(value: unknown, index: number): ParseResult<FinanceKitIngestAccount> {
  if (!isRecord(value)) {
    return parseError(`accounts[${index}] must be an object.`);
  }

  const id = requiredCleanString(value.id, `accounts[${index}].id`);
  const displayName = requiredCleanString(value.display_name, `accounts[${index}].display_name`);
  const institutionName = optionalCleanString(value.institution_name, `accounts[${index}].institution_name`);
  const currency = requiredCleanString(value.currency, `accounts[${index}].currency`);

  const accountFieldError = firstParseError(id, displayName, institutionName, currency);

  if (accountFieldError) {
    return parseError(accountFieldError);
  }

  if (value.type !== "credit" && value.type !== "asset") {
    return parseError(`accounts[${index}].type must be "credit" or "asset".`);
  }

  const balance = optionalFiniteNumber(value.balance, `accounts[${index}].balance`);

  if (!balance.ok) {
    return parseError(balance.error);
  }

  const balanceAsOf = optionalIsoDateTime(value.balance_as_of, `accounts[${index}].balance_as_of`);

  if (!balanceAsOf.ok) {
    return parseError(balanceAsOf.error);
  }

  return {
    ok: true,
    value: {
      balance: balance.value,
      balanceAsOf: balanceAsOf.value,
      currency: parseValue(currency),
      displayName: parseValue(displayName),
      id: parseValue(id),
      institutionName: parseValue(institutionName),
      type: value.type as FinanceKitAccountKind
    }
  };
}

function parseFinanceKitTransaction(
  value: unknown,
  index: number,
  accountIds: Set<string>
): ParseResult<FinanceKitIngestTransaction> {
  if (!isRecord(value)) {
    return parseError(`transactions[${index}] must be an object.`);
  }

  const id = requiredCleanString(value.id, `transactions[${index}].id`);
  const accountId = requiredCleanString(value.account_id, `transactions[${index}].account_id`);
  const currency = requiredCleanString(value.currency, `transactions[${index}].currency`);
  const merchantName = optionalCleanString(value.merchant_name, `transactions[${index}].merchant_name`);
  const description = optionalCleanString(value.description, `transactions[${index}].description`);
  const postedDate = requiredIsoDate(value.posted_date, `transactions[${index}].posted_date`);

  const transactionFieldError = firstParseError(id, accountId, currency, merchantName, description, postedDate);

  if (transactionFieldError) {
    return parseError(transactionFieldError);
  }

  const accountIdValue = parseValue(accountId);

  if (!accountIds.has(accountIdValue)) {
    return parseError(`transactions[${index}].account_id must reference an account in this request.`);
  }

  if (value.credit_debit !== "credit" && value.credit_debit !== "debit") {
    return parseError(`transactions[${index}].credit_debit must be "credit" or "debit".`);
  }

  const amountMinor = optionalMinorAmount(value.amount_minor, `transactions[${index}].amount_minor`);
  const amount = optionalFiniteNumber(value.amount, `transactions[${index}].amount`);

  const amountFieldError = firstParseError(amountMinor, amount);

  if (amountFieldError) {
    return parseError(amountFieldError);
  }

  const amountMinorValue = parseValue(amountMinor);
  const amountValue = parseValue(amount);

  if (amountMinorValue === undefined && amountValue === undefined) {
    return parseError(`transactions[${index}] must include amount_minor or amount.`);
  }

  if (amountMinorValue !== undefined && amountMinorValue < 0) {
    return parseError(`transactions[${index}].amount_minor must be positive.`);
  }

  if (amountValue !== undefined && amountValue < 0) {
    return parseError(`transactions[${index}].amount must be positive.`);
  }

  if (value.pending !== undefined && typeof value.pending !== "boolean") {
    return parseError(`transactions[${index}].pending must be a boolean.`);
  }

  return {
    ok: true,
    value: {
      accountId: accountIdValue,
      amount: amountValue,
      amountMinor: amountMinorValue,
      creditDebit: value.credit_debit as FinanceKitCreditDebit,
      currency: parseValue(currency),
      description: parseValue(description),
      id: parseValue(id),
      merchantName: parseValue(merchantName),
      pending: value.pending ?? false,
      postedDate: parseValue(postedDate)
    }
  };
}

function mapFinanceKitAccountToDomain(account: FinanceKitIngestAccount, ingestedAt: string): Account {
  const type = mapFinanceKitAccountType(account);
  const balance = account.balance === undefined ? 0 : roundMoney(account.balance);
  const currentBalance = type === "credit_card" ? -Math.abs(balance) : balance;

  return {
    id: accountIdForFinanceKit(account.id),
    providerConnectionId: financeKitProviderConnectionId,
    groupId: groupIdForAccountType(type),
    name: account.displayName,
    institutionName: account.institutionName ?? "Apple Wallet",
    type,
    currency: normalizeProviderCurrencyCode(account.currency),
    currentBalance,
    includedInNetWorth: true,
    lastUpdatedAt: account.balanceAsOf ?? ingestedAt
  };
}

function mapFinanceKitTransactionToDomain(transaction: FinanceKitIngestTransaction, account: Account): Transaction {
  const description = transaction.description ?? transaction.merchantName ?? "FinanceKit transaction";
  const merchantName = transaction.merchantName ?? cleanDescription(description);
  const amount = amountForFinanceKitTransaction(transaction);
  const categoryId = mapProviderTransactionCategory({
    accountType: account.type,
    amount,
    description,
    merchantName
  });

  return {
    id: transactionIdForFinanceKit(transaction.id),
    accountId: account.id,
    providerConnectionId: account.providerConnectionId,
    date: transaction.postedDate,
    authorizedDate: transaction.pending ? transaction.postedDate : undefined,
    postedDate: transaction.pending ? undefined : transaction.postedDate,
    merchantName,
    description,
    amount,
    currency: normalizeProviderCurrencyCode(transaction.currency),
    categoryId,
    status: transaction.pending ? "pending" : "posted",
    reviewed: false,
    tags: ["financekit"]
  };
}

function amountForFinanceKitTransaction(transaction: FinanceKitIngestTransaction): number {
  const absoluteAmount =
    transaction.amountMinor === undefined
      ? roundMoney(transaction.amount ?? 0)
      : roundMoney(transaction.amountMinor / 100);

  return transaction.creditDebit === "debit" ? -Math.abs(absoluteAmount) : Math.abs(absoluteAmount);
}

function createFinanceKitBalanceSnapshot(
  account: Account,
  input: FinanceKitIngestAccount,
  capturedAt: string
): AccountBalanceSnapshot {
  return {
    id: `${account.id}_${capturedAt.replace(/[^0-9a-z]/gi, "")}`,
    accountId: account.id,
    asOfDate: (input.balanceAsOf ?? capturedAt).slice(0, 10),
    capturedAt,
    ledgerBalance: account.currentBalance,
    currency: account.currency,
    source: "financekit"
  };
}

function mapFinanceKitAccountType(account: FinanceKitIngestAccount): AccountType {
  if (account.type === "credit") {
    return "credit_card";
  }

  if (/\bsavings?\b/i.test(`${account.displayName} ${account.institutionName ?? ""}`)) {
    return "savings";
  }

  return "cash";
}

function groupIdForAccountType(accountType: AccountType): string {
  if (accountType === "credit_card") {
    return "group_credit";
  }

  return "group_cash";
}

function requiredCleanString(value: unknown, field: string): ParseResult<string> {
  const parsed = optionalCleanString(value, field);

  if (!parsed.ok) {
    return parsed;
  }

  if (!parsed.value) {
    return parseError(`${field} is required.`);
  }

  return { ok: true, value: parsed.value };
}

function optionalCleanString(value: unknown, field: string): ParseResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "string") {
    return parseError(`${field} must be a string.`);
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

function optionalFiniteNumber(value: unknown, field: string): ParseResult<number | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return parseError(`${field} must be a finite number.`);
  }

  return { ok: true, value };
}

function optionalMinorAmount(value: unknown, field: string): ParseResult<number | undefined> {
  const parsed = optionalFiniteNumber(value, field);

  if (!parsed.ok || parsed.value === undefined) {
    return parsed;
  }

  if (!Number.isInteger(parsed.value)) {
    return parseError(`${field} must be an integer.`);
  }

  return parsed;
}

function requiredIsoDate(value: unknown, field: string): ParseResult<string> {
  const parsed = requiredCleanString(value, field);

  if (!parsed.ok) {
    return parseError(parsed.error);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.value) || Number.isNaN(Date.parse(`${parsed.value}T00:00:00.000Z`))) {
    return parseError(`${field} must be an ISO date in YYYY-MM-DD format.`);
  }

  return parsed;
}

function optionalIsoDateTime(value: unknown, field: string): ParseResult<string | undefined> {
  const parsed = optionalCleanString(value, field);

  if (!parsed.ok || parsed.value === undefined) {
    return parsed;
  }

  if (Number.isNaN(Date.parse(parsed.value))) {
    return parseError(`${field} must be an ISO timestamp.`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseError<T = never>(error: string): ParseResult<T> {
  return { error, ok: false };
}

function parseValue<T>(result: ParseResult<T>): T {
  if (!result.ok) {
    throw new FinanceKitIngestError(result.error);
  }

  return result.value;
}

function firstParseError(...results: Array<ParseResult<unknown>>): string | undefined {
  for (const result of results) {
    if (!result.ok) {
      return result.error;
    }
  }

  return undefined;
}

function cleanDescription(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 96) || "FinanceKit transaction";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function dedupeByRawId<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function stableIdSuffix(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

function latestIso(values: string[]): string | undefined {
  return values
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left))[0];
}
