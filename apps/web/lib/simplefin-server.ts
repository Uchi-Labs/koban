import { createHash } from "node:crypto";
import type { Account, AccountType, ProviderConnection, Transaction } from "@ai-finances/schema";
import {
  listConnectionInventory,
  readFinanceDbSnapshot,
  readSyncStateValue,
  replaceSimpleFinLedgerSnapshot
} from "@/lib/db/finance-db";
import { SimpleFinSyncError, syncErrorMessage } from "@/lib/effect/sync-errors";
import { runServerEffect } from "@/lib/effect/runtime";
import { type AccountBalanceSnapshot, invalidateShellDataCache } from "@/lib/finance-data";
import { normalizeProviderCurrencyCode } from "@/lib/currency";
import { mapProviderTransactionCategory } from "@/lib/provider-transaction-category";
import { getHealthyPlaidStandbyInstitutionIds } from "@/lib/plaid-server";
import { isSimpleFinAccountOnPlaidStandby } from "@/lib/plaid-standby";
import { readWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";
import { Effect } from "effect";

export interface SimpleFinReportedError {
  [key: string]: unknown;
}

export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  pending?: boolean;
  payee?: string;
  memo?: string;
}

export interface SimpleFinOrg {
  domain?: string;
  name?: string;
  "sfin-url"?: string;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  org?: SimpleFinOrg;
  conn_id?: string;
  conn_name?: string;
  currency?: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: SimpleFinTransaction[];
}

export interface SimpleFinConnection {
  conn_id?: string;
  name?: string;
  org_name?: string;
  org_url?: string;
  sfin_url?: string;
}

export interface SimpleFinAccountSet {
  accounts?: SimpleFinAccount[];
  connections?: SimpleFinConnection[];
  errors?: unknown[];
  errlist?: unknown[];
}

export interface SimpleFinAccountSummary {
  balanceAsOf?: string;
  currency: string;
  currentBalance: number;
  id: string;
  name: string;
  standby: boolean;
  type: AccountType;
}

export interface SimpleFinConnectionSummary {
  accountCount: number;
  accounts: SimpleFinAccountSummary[];
  errorMessage?: string;
  id: string;
  lastSyncedAt?: string;
  name: string;
  status: ProviderConnection["status"];
  transactionCount: number;
}

export interface SimpleFinSetupStatus {
  accessUrlConfigured: boolean;
  configured: boolean;
  connectionCount: number;
  connections: SimpleFinConnectionSummary[];
  lastErrors: unknown[];
  lastSyncedAt?: string;
  latestBalanceAsOf?: string;
  readyForSync: boolean;
  storedAccountCount: number;
  storedTransactionCount: number;
}

export interface SimpleFinSyncResult {
  accountCount: number;
  connectionCount: number;
  errors: unknown[];
  lastSyncedAt: string;
  newestPostedAt?: number;
  ok: boolean;
  requestEndUnix: number;
  requestStartUnix: number;
  status: SimpleFinSetupStatus;
  transactionCount: number;
}

interface SimpleFinConfig {
  accessUrl?: string;
  configured: boolean;
}

interface ParsedSimpleFinAccessUrl {
  authorization: string;
  baseUrl: string;
}

interface SimpleFinOrgIdentity {
  displayName: string;
  key: string;
}

export class SimpleFinSetupError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const simpleFinNewestPostedStateKey = "simplefin_newest_posted_at";
const simpleFinLastErrorsStateKey = "simplefin_last_errors";
const simpleFinLastSyncedStateKey = "simplefin_last_synced_at";

const simpleFinFirstSyncLookbackDays = 45;
const simpleFinIncrementalOverlapDays = 3;
const simpleFinMaxWindowDays = 90;
const millisecondsPerDay = 86_400_000;

export async function getSimpleFinSetupStatus(): Promise<SimpleFinSetupStatus> {
  const config = readSimpleFinConfig();
  const [snapshot, inventory, storedErrors] = await Promise.all([
    readFinanceDbSnapshot(),
    listConnectionInventory(),
    readStoredSimpleFinErrors()
  ]);
  const simpleFinConnections = (snapshot?.providerConnections ?? []).filter(
    (connection) => connection.provider === "simplefin"
  );
  const connectionIds = new Set(simpleFinConnections.map((connection) => connection.id));
  const accountsByConnection = new Map<string, SimpleFinAccountSummary[]>();
  let storedAccountCount = 0;
  let storedTransactionCount = 0;
  let latestBalanceAsOf: string | undefined;

  for (const account of inventory.accounts) {
    if (!connectionIds.has(account.providerConnectionId)) {
      continue;
    }

    const balanceAsOf = account.lastUpdatedAt;
    const list = accountsByConnection.get(account.providerConnectionId) ?? [];
    list.push({
      balanceAsOf,
      currency: account.currency,
      currentBalance: account.currentBalance,
      id: account.id,
      name: account.name,
      standby: !account.includedInNetWorth,
      type: account.type
    });
    accountsByConnection.set(account.providerConnectionId, list);
    storedAccountCount += 1;

    if (!latestBalanceAsOf || balanceAsOf > latestBalanceAsOf) {
      latestBalanceAsOf = balanceAsOf;
    }
  }

  for (const connectionId of connectionIds) {
    storedTransactionCount += inventory.transactionCountByConnection[connectionId] ?? 0;
  }

  const lastSyncedAt =
    (await readSyncStateValue(simpleFinLastSyncedStateKey)) ??
    latestIso(simpleFinConnections.flatMap((connection) => connection.lastSyncedAt ?? []));

  return {
    accessUrlConfigured: hasValue(config.accessUrl),
    configured: config.configured,
    connectionCount: simpleFinConnections.length,
    connections: simpleFinConnections.map((connection) => ({
      accountCount: accountsByConnection.get(connection.id)?.length ?? 0,
      accounts: accountsByConnection.get(connection.id) ?? [],
      errorMessage: connection.errorMessage,
      id: connection.id,
      lastSyncedAt: connection.lastSyncedAt,
      name: connection.displayName.replace(/^SimpleFIN -\s*/, ""),
      status: connection.status,
      transactionCount: inventory.transactionCountByConnection[connection.id] ?? 0
    })),
    lastErrors: storedErrors,
    lastSyncedAt,
    latestBalanceAsOf,
    readyForSync: config.configured,
    storedAccountCount,
    storedTransactionCount
  };
}

export function syncSimpleFinData(): Promise<SimpleFinSyncResult> {
  return runServerEffect(syncSimpleFinDataEffect());
}

export function syncSimpleFinDataEffect(): Effect.Effect<SimpleFinSyncResult, SimpleFinSyncError, never> {
  return Effect.tryPromise({
    try: syncSimpleFinDataInternal,
    catch: (error) =>
      new SimpleFinSyncError({
        cause: error,
        message: simpleFinErrorMessage(error, "SimpleFIN sync failed.")
      })
  });
}

export function isSimpleFinConfigured(env: WorkspaceEnv = readWorkspaceEnv()): boolean {
  return readSimpleFinConfig(env).configured;
}

export function skippedSimpleFinSyncResult(reason = "not_configured"): SimpleFinSyncResult {
  const now = new Date().toISOString();

  return {
    accountCount: 0,
    connectionCount: 0,
    errors: [],
    lastSyncedAt: now,
    ok: true,
    requestEndUnix: Math.floor(Date.now() / 1000),
    requestStartUnix: Math.floor((Date.now() - simpleFinFirstSyncLookbackDays * millisecondsPerDay) / 1000),
    status: {
      accessUrlConfigured: false,
      configured: false,
      connectionCount: 0,
      connections: [],
      lastErrors: reason === "not_configured" ? [] : [{ reason }],
      readyForSync: false,
      storedAccountCount: 0,
      storedTransactionCount: 0
    },
    transactionCount: 0
  };
}

async function syncSimpleFinDataInternal(): Promise<SimpleFinSyncResult> {
  const startedAt = new Date().toISOString();
  const config = requireSimpleFinConfig();
  const previousNewestPosted = await readSimpleFinNewestPostedAt();
  const window = computeSimpleFinSyncWindow({ lastSuccessfulNewestPosted: previousNewestPosted });
  const accountSet = await fetchSimpleFinAccountSet({
    accessUrl: config.accessUrl,
    endUnix: window.endUnix,
    startUnix: window.startUnix
  });
  const finishedAt = new Date().toISOString();
  const mapped = mapSimpleFinAccountSetToDomain({
    accountSet,
    healthyPlaidInstitutionIds: await getHealthyPlaidStandbyInstitutionIds(),
    syncedAt: finishedAt
  });
  const record = await replaceSimpleFinLedgerSnapshot({
    accounts: mapped.accounts,
    balanceSnapshots: mapped.balanceSnapshots,
    errors: mapped.errors,
    finishedAt,
    newestPostedAt: mapped.newestPostedAt,
    providerConnections: mapped.providerConnections,
    requestEndUnix: window.endUnix,
    requestStartUnix: window.startUnix,
    startedAt,
    successful: mapped.errors.length === 0,
    transactions: mapped.transactions
  });

  invalidateShellDataCache();

  return {
    accountCount: record.accountCount,
    connectionCount: record.connectionCount,
    errors: mapped.errors,
    lastSyncedAt: record.lastSyncedAt,
    newestPostedAt: record.newestPostedAt,
    ok: mapped.errors.length === 0,
    requestEndUnix: window.endUnix,
    requestStartUnix: window.startUnix,
    status: await getSimpleFinSetupStatus(),
    transactionCount: record.transactionCount
  };
}

export function mapSimpleFinAccountSetToDomain({
  accountSet,
  healthyPlaidInstitutionIds = new Set(),
  syncedAt
}: {
  accountSet: SimpleFinAccountSet;
  healthyPlaidInstitutionIds?: Set<string>;
  syncedAt: string;
}): {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  errors: unknown[];
  newestPostedAt?: number;
  providerConnections: ProviderConnection[];
  transactions: Transaction[];
} {
  const connectionById = new Map(
    (accountSet.connections ?? [])
      .filter((connection) => hasValue(connection.conn_id))
      .map((connection) => [connection.conn_id as string, connection])
  );
  const errors = normalizeSimpleFinErrors(accountSet);
  const accounts: Account[] = [];
  const balanceSnapshots: AccountBalanceSnapshot[] = [];
  const providerConnectionsById = new Map<string, ProviderConnection>();
  const transactions: Transaction[] = [];
  let newestPostedAt: number | undefined;

  for (const simpleFinAccount of accountSet.accounts ?? []) {
    const connection = simpleFinAccount.conn_id ? connectionById.get(simpleFinAccount.conn_id) : undefined;
    const org = readSimpleFinOrgIdentity(simpleFinAccount, connection);
    const providerConnectionId = providerConnectionIdForSimpleFin(org.key);
    const balance = parseSimpleFinMoney(simpleFinAccount.balance);
    const availableBalance =
      simpleFinAccount["available-balance"] === undefined
        ? undefined
        : parseSimpleFinMoney(simpleFinAccount["available-balance"]);
    const balanceAsOf = unixSecondsToIso(simpleFinAccount["balance-date"], syncedAt);
    const accountType = inferSimpleFinAccountType({
      balance,
      name: simpleFinAccount.name,
      orgName: org.displayName
    });
    const standby = isSimpleFinAccountOnPlaidStandby({
      accountName: simpleFinAccount.name,
      healthyPlaidInstitutionIds,
      orgDisplayName: org.displayName,
      orgKey: org.key
    });
    const account = mapSimpleFinAccountToDomain({
      account: simpleFinAccount,
      accountType,
      balance,
      availableBalance,
      balanceAsOf,
      org,
      providerConnectionId,
      standby
    });

    accounts.push(account);
    providerConnectionsById.set(providerConnectionId, {
      configured: true,
      displayName: `SimpleFIN - ${org.displayName}`,
      errorMessage: errors.length > 0 ? simpleFinErrorsToMessage(errors) : undefined,
      id: providerConnectionId,
      lastSyncedAt: syncedAt,
      provider: "simplefin",
      status: errors.length > 0 ? "error" : "connected"
    });
    balanceSnapshots.push(createSimpleFinBalanceSnapshot(account, balanceAsOf));

    if (standby) {
      continue;
    }

    for (const simpleFinTransaction of simpleFinAccount.transactions ?? []) {
      const transaction = mapSimpleFinTransactionToDomain({
        account,
        accountType,
        providerConnectionId,
        transaction: simpleFinTransaction
      });

      transactions.push(transaction);

      if (simpleFinTransaction.posted > 0 && (newestPostedAt === undefined || simpleFinTransaction.posted > newestPostedAt)) {
        newestPostedAt = simpleFinTransaction.posted;
      }
    }
  }

  return {
    accounts: dedupeById(accounts),
    balanceSnapshots: dedupeById(balanceSnapshots),
    errors,
    newestPostedAt,
    providerConnections: Array.from(providerConnectionsById.values()),
    transactions: dedupeById(transactions).sort((left, right) => right.date.localeCompare(left.date))
  };
}

function mapSimpleFinAccountToDomain({
  account,
  accountType,
  balance,
  availableBalance,
  balanceAsOf,
  org,
  providerConnectionId,
  standby = false
}: {
  account: SimpleFinAccount;
  accountType: AccountType;
  balance: number;
  availableBalance?: number;
  balanceAsOf: string;
  org: SimpleFinOrgIdentity;
  providerConnectionId: string;
  standby?: boolean;
}): Account {
  return {
    id: accountIdForSimpleFin(org.key, account.id),
    providerConnectionId,
    groupId: groupIdForAccountType(accountType),
    name: cleanString(account.name) ?? "SimpleFIN account",
    institutionName: org.displayName,
    type: accountType,
    currency: normalizeProviderCurrencyCode(account.currency),
    currentBalance: balance,
    availableBalance,
    includedInNetWorth: !standby,
    lastUpdatedAt: balanceAsOf
  };
}

function mapSimpleFinTransactionToDomain({
  account,
  accountType,
  providerConnectionId,
  transaction
}: {
  account: Account;
  accountType: AccountType;
  providerConnectionId: string;
  transaction: SimpleFinTransaction;
}): Transaction {
  const description = cleanString(transaction.description) ?? "SimpleFIN transaction";
  const merchantName = cleanString(transaction.payee) ?? cleanString(transaction.memo) ?? cleanDescription(description);
  const amount = parseSimpleFinMoney(transaction.amount);
  const date = transaction.posted > 0 ? unixSecondsToIso(transaction.posted).slice(0, 10) : new Date(0).toISOString().slice(0, 10);
  const categoryId = mapProviderTransactionCategory({
    accountType,
    amount,
    description,
    merchantName
  });

  return {
    id: transactionIdForSimpleFin(account.id, transaction.id),
    accountId: account.id,
    providerConnectionId,
    date,
    authorizedDate: transaction.pending ? date : undefined,
    postedDate: transaction.pending ? undefined : date,
    merchantName,
    description,
    amount,
    currency: account.currency,
    categoryId,
    status: transaction.pending ? "pending" : "posted",
    reviewed: false,
    tags: ["simplefin"]
  };
}

export function inferSimpleFinAccountType({
  balance,
  name,
  orgName
}: {
  balance: number;
  name: string;
  orgName?: string;
}): AccountType {
  if (/\b(?:credit card|card)\b/i.test(name)) {
    return "credit_card";
  }

  if (balance < 0 && /\b(?:discover|american express|amex|capital one|citi|chase|barclays|synchrony)\b/i.test(orgName ?? "")) {
    return "credit_card";
  }

  if (/\bsavings?\b/i.test(name)) {
    return "savings";
  }

  if (/\bchecking\b/i.test(name)) {
    return "checking";
  }

  return "cash";
}

export function computeSimpleFinSyncWindow({
  lastSuccessfulNewestPosted,
  now = new Date()
}: {
  lastSuccessfulNewestPosted?: number;
  now?: Date;
} = {}): { endUnix: number; startUnix: number } {
  const endUnix = Math.floor(now.getTime() / 1000);
  const maxStartUnix = endUnix - simpleFinMaxWindowDays * 86_400;
  const defaultStartUnix = endUnix - simpleFinFirstSyncLookbackDays * 86_400;
  const incrementalStartUnix =
    lastSuccessfulNewestPosted === undefined
      ? defaultStartUnix
      : lastSuccessfulNewestPosted - simpleFinIncrementalOverlapDays * 86_400;

  return {
    endUnix,
    startUnix: Math.max(maxStartUnix, Math.min(incrementalStartUnix, endUnix))
  };
}

export function parseSimpleFinMoney(value: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^([+-])?(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new SimpleFinSetupError("SimpleFIN returned an invalid money string.", 502);
  }

  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number.parseInt(match[2], 10);
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const cents = Number.parseInt(fraction.slice(0, 2), 10);
  const shouldRound = Number.parseInt(fraction[2] ?? "0", 10) >= 5;
  const minor = whole * 100 + cents + (shouldRound ? 1 : 0);

  return (sign * minor) / 100;
}

export function providerConnectionIdForSimpleFin(orgKey: string): string {
  return `provider_simplefin_${stableIdSuffix(orgKey)}`;
}

export function accountIdForSimpleFin(orgKey: string, accountId: string): string {
  return `simplefin_acct_${stableIdSuffix(`${orgKey}:${accountId}`)}`;
}

export function transactionIdForSimpleFin(accountId: string, transactionId: string): string {
  return `simplefin_txn_${stableIdSuffix(`${accountId}:${transactionId}`)}`;
}

async function fetchSimpleFinAccountSet({
  accessUrl,
  endUnix,
  startUnix
}: {
  accessUrl: string;
  endUnix: number;
  startUnix: number;
}): Promise<SimpleFinAccountSet> {
  const parsed = parseSimpleFinAccessUrl(accessUrl);
  const url = new URL(`${parsed.baseUrl}/accounts`);
  url.searchParams.set("version", "2");
  url.searchParams.set("start-date", String(startUnix));
  url.searchParams.set("end-date", String(endUnix));

  const response = await fetch(url, {
    headers: {
      Authorization: parsed.authorization,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new SimpleFinSetupError(`SimpleFIN API returned HTTP ${response.status}.`, response.status);
  }

  try {
    return (await response.json()) as SimpleFinAccountSet;
  } catch {
    throw new SimpleFinSetupError("SimpleFIN API returned invalid JSON.", 502);
  }
}

function parseSimpleFinAccessUrl(accessUrl: string): ParsedSimpleFinAccessUrl {
  let url: URL;

  try {
    url = new URL(accessUrl);
  } catch {
    throw new SimpleFinSetupError("SIMPLEFIN_ACCESS_URL is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new SimpleFinSetupError("SIMPLEFIN_ACCESS_URL must use HTTPS.");
  }

  const username = decodeUriComponentSafe(url.username);
  const password = decodeUriComponentSafe(url.password);

  if (!username || !password) {
    throw new SimpleFinSetupError("SIMPLEFIN_ACCESS_URL must include Basic-auth credentials.");
  }

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  return {
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    baseUrl: url.toString().replace(/\/+$/, "")
  };
}

function readSimpleFinConfig(env: WorkspaceEnv = readWorkspaceEnv()): SimpleFinConfig {
  const accessUrl = cleanString(env.SIMPLEFIN_ACCESS_URL);

  return {
    accessUrl,
    configured: hasValue(accessUrl)
  };
}

function requireSimpleFinConfig(env: WorkspaceEnv = readWorkspaceEnv()): Required<SimpleFinConfig> {
  const config = readSimpleFinConfig(env);

  if (!hasValue(config.accessUrl)) {
    throw new SimpleFinSetupError("SIMPLEFIN_ACCESS_URL is missing in the ignored local .env file.");
  }

  parseSimpleFinAccessUrl(config.accessUrl);

  return {
    accessUrl: config.accessUrl,
    configured: true
  };
}

function readSimpleFinOrgIdentity(account: SimpleFinAccount, connection: SimpleFinConnection | undefined): SimpleFinOrgIdentity {
  const displayName =
    cleanString(account.org?.name) ??
    cleanString(account.org?.domain) ??
    cleanString(connection?.org_name) ??
    cleanString(connection?.org_url) ??
    cleanString(connection?.name) ??
    cleanString(account.conn_name) ??
    "SimpleFIN";
  const key =
    cleanString(account.org?.["sfin-url"]) ??
    cleanString(account.org?.domain) ??
    cleanString(connection?.sfin_url) ??
    cleanString(connection?.org_url) ??
    cleanString(connection?.conn_id) ??
    displayName;

  return { displayName, key };
}

function normalizeSimpleFinErrors(accountSet: SimpleFinAccountSet): unknown[] {
  if (Array.isArray(accountSet.errors)) {
    return accountSet.errors;
  }

  if (Array.isArray(accountSet.errlist)) {
    return accountSet.errlist;
  }

  return [];
}

async function readStoredSimpleFinErrors(): Promise<unknown[]> {
  const raw = await readSyncStateValue(simpleFinLastErrorsStateKey);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readSimpleFinNewestPostedAt(): Promise<number | undefined> {
  const value = await readSyncStateValue(simpleFinNewestPostedStateKey);
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createSimpleFinBalanceSnapshot(account: Account, balanceAsOf: string): AccountBalanceSnapshot {
  return {
    id: `${account.id}_${balanceAsOf.replace(/[^0-9a-z]/gi, "")}`,
    accountId: account.id,
    asOfDate: balanceAsOf.slice(0, 10),
    capturedAt: balanceAsOf,
    ledgerBalance: account.currentBalance,
    availableBalance: account.availableBalance,
    currency: account.currency,
    source: "simplefin"
  };
}

function groupIdForAccountType(accountType: AccountType) {
  if (accountType === "credit_card") {
    return "group_credit";
  }

  if (accountType === "investment") {
    return "group_investments";
  }

  if (accountType === "loan") {
    return "group_other";
  }

  return "group_cash";
}

function unixSecondsToIso(seconds: number, fallback = new Date().toISOString()): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return fallback;
  }

  return new Date(seconds * 1000).toISOString();
}

function cleanDescription(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function simpleFinErrorsToMessage(errors: unknown[]): string | undefined {
  if (errors.length === 0) {
    return undefined;
  }

  return errors
    .map((error) => {
      if (typeof error === "string") {
        return error;
      }

      if (error && typeof error === "object") {
        const record = error as Record<string, unknown>;
        const code = typeof record.code === "string" ? record.code : undefined;
        const message =
          typeof record.message === "string"
            ? record.message
            : typeof record.msg === "string"
              ? record.msg
              : undefined;
        return [code, message].filter(Boolean).join(": ") || JSON.stringify(error);
      }

      return String(error);
    })
    .join(" | ");
}

function simpleFinErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SimpleFinSetupError) {
    return error.message;
  }

  return syncErrorMessage(error, fallback);
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function latestIso(values: string[]): string | undefined {
  return values
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left))[0];
}

function stableIdSuffix(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}
