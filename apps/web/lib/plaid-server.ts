import { createHash } from "node:crypto";
import type { Account, AccountType, ProviderConnection, Transaction } from "@ai-finances/schema";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type ItemPublicTokenExchangeRequest,
  type ItemPublicTokenExchangeResponse,
  type LinkTokenCreateRequest,
  type LinkTokenCreateResponse,
  type RemovedTransaction,
  type Transaction as PlaidTransaction,
  type TransactionsSyncRequest,
  type TransactionsSyncResponse
} from "plaid";
import {
  listConnectionInventory,
  readFinanceDbSnapshot,
  readSyncStateValue,
  replacePlaidLedgerSnapshot,
  writeSyncStateValue
} from "@/lib/db/finance-db";
import { PlaidSyncError } from "@/lib/effect/sync-errors";
import { runServerEffect } from "@/lib/effect/runtime";
import { type AccountBalanceSnapshot, invalidateShellDataCache } from "@/lib/finance-data";
import { normalizeProviderCurrencyCode } from "@/lib/currency";
import { mapProviderTransactionCategory } from "@/lib/provider-transaction-category";
import {
  healthyPlaidStandbyInstitutionIds,
  plaidInstitutionName
} from "@/lib/plaid-standby";
import { readWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";
import { Effect } from "effect";

export interface StoredPlaidItem {
  accessToken: string;
  errorMessage?: string;
  institutionId?: string;
  institutionName?: string;
  itemId: string;
  lastSyncedAt?: string;
  linkedAt: string;
  nextCursor?: string;
}

export interface PlaidAccountSummary {
  currency: string;
  currentBalance: number;
  id: string;
  mask?: string;
  name: string;
  type: AccountType;
}

export interface PlaidItemSummary {
  accountCount: number;
  accounts: PlaidAccountSummary[];
  cursorPresent: boolean;
  errorMessage?: string;
  id: string;
  institutionId?: string;
  institutionName: string;
  lastSyncedAt?: string;
  status: ProviderConnection["status"];
  transactionCount: number;
}

export interface PlaidSetupStatus {
  clientIdConfigured: boolean;
  configured: boolean;
  environment: PlaidEnvironmentName;
  itemCount: number;
  items: PlaidItemSummary[];
  lastSyncedAt?: string;
  readyForLink: boolean;
  readyForSync: boolean;
  redirectUriConfigured: boolean;
  secretConfigured: boolean;
  standbyInstitutionNames: string[];
  storedAccountCount: number;
  storedTransactionCount: number;
}

export interface PlaidLinkTokenResult {
  expiration?: string;
  linkToken: string;
  requestId?: string;
}

export interface PlaidPublicTokenExchangeInput {
  institutionId?: string;
  institutionName?: string;
  publicToken: string;
}

export interface PlaidPublicTokenExchangeResult {
  item: PlaidItemSummary;
  status: PlaidSetupStatus;
}

export interface PlaidSyncResult {
  accountCount: number;
  errors: string[];
  itemCount: number;
  lastSyncedAt: string;
  ok: boolean;
  removedTransactionCount: number;
  status: PlaidSetupStatus;
  transactionCount: number;
}

export interface PlaidApiClient {
  itemPublicTokenExchange(request: ItemPublicTokenExchangeRequest): Promise<{ data: ItemPublicTokenExchangeResponse }>;
  linkTokenCreate(request: LinkTokenCreateRequest): Promise<{ data: LinkTokenCreateResponse }>;
  transactionsSync(request: TransactionsSyncRequest): Promise<{ data: TransactionsSyncResponse }>;
}

interface PlaidConfig {
  clientId?: string;
  configured: boolean;
  environment: PlaidEnvironmentName;
  redirectUri?: string;
  secret?: string;
}

interface PlaidItemSyncPageSet {
  accounts: Account[];
  balanceSnapshots: AccountBalanceSnapshot[];
  nextCursor?: string;
  removedTransactionIds: string[];
  transactions: Transaction[];
}

type PlaidEnvironmentName = "sandbox" | "production";

export class PlaidSetupError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export const plaidItemsStateKey = "plaid_items_v1";

export async function getPlaidSetupStatus(): Promise<PlaidSetupStatus> {
  const config = readPlaidConfig();
  const [items, snapshot, inventory] = await Promise.all([
    readStoredPlaidItems(),
    readFinanceDbSnapshot(),
    listConnectionInventory()
  ]);
  const plaidConnections = (snapshot?.providerConnections ?? []).filter((connection) => connection.provider === "plaid");
  const localConnectionById = new Map(plaidConnections.map((connection) => [connection.id, connection]));
  const accountsByConnection = new Map<string, PlaidAccountSummary[]>();
  let storedAccountCount = 0;
  let storedTransactionCount = 0;

  for (const account of inventory.accounts) {
    if (inventory.providerByConnection[account.providerConnectionId] !== "plaid") {
      continue;
    }

    const accounts = accountsByConnection.get(account.providerConnectionId) ?? [];
    accounts.push({
      currency: account.currency,
      currentBalance: account.currentBalance,
      id: account.id,
      mask: account.mask,
      name: account.name,
      type: account.type
    });
    accountsByConnection.set(account.providerConnectionId, accounts);
    storedAccountCount += 1;
  }

  for (const connection of plaidConnections) {
    storedTransactionCount += inventory.transactionCountByConnection[connection.id] ?? 0;
  }

  const itemSummaries = items.map((item) => {
    const providerConnectionId = providerConnectionIdForPlaid(item.itemId);
    const localConnection = localConnectionById.get(providerConnectionId);
    const status: ProviderConnection["status"] = item.errorMessage ? "error" : (localConnection?.status ?? "connected");

    return {
      accountCount: accountsByConnection.get(providerConnectionId)?.length ?? 0,
      accounts: accountsByConnection.get(providerConnectionId) ?? [],
      cursorPresent: Boolean(item.nextCursor),
      errorMessage: item.errorMessage ?? localConnection?.errorMessage,
      id: item.itemId,
      institutionId: item.institutionId,
      institutionName: item.institutionName ?? plaidInstitutionName(item.institutionId),
      lastSyncedAt: item.lastSyncedAt ?? localConnection?.lastSyncedAt,
      status,
      transactionCount: inventory.transactionCountByConnection[providerConnectionId] ?? 0
    } satisfies PlaidItemSummary;
  });
  const lastSyncedAt = latestIso(itemSummaries.flatMap((item) => item.lastSyncedAt ?? []));
  const standbyInstitutionNames = [...healthyPlaidStandbyInstitutionIds(items)]
    .map((institutionId) => plaidInstitutionName(institutionId))
    .sort();

  return {
    clientIdConfigured: hasValue(config.clientId),
    configured: config.configured,
    environment: config.environment,
    itemCount: itemSummaries.length,
    items: itemSummaries,
    lastSyncedAt,
    readyForLink: config.configured,
    readyForSync: config.configured && items.length > 0,
    redirectUriConfigured: hasValue(config.redirectUri),
    secretConfigured: hasValue(config.secret),
    standbyInstitutionNames,
    storedAccountCount,
    storedTransactionCount
  };
}

export async function createPlaidLinkToken(client: PlaidApiClient = createPlaidClient()): Promise<PlaidLinkTokenResult> {
  const config = requirePlaidConfig();
  const request = {
    client_name: "Koban",
    country_codes: [CountryCode.Us],
    language: "en",
    products: [Products.Transactions],
    transactions: {
      days_requested: 730
    },
    user: {
      client_user_id: "ai-finances-local"
    },
    ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {})
  };
  const response = await client.linkTokenCreate(request);

  if (!response.data.link_token) {
    throw new PlaidSetupError("Plaid did not return a Link token.", 502);
  }

  return {
    expiration: response.data.expiration,
    linkToken: response.data.link_token,
    requestId: response.data.request_id
  };
}

export async function exchangePlaidPublicToken(
  input: PlaidPublicTokenExchangeInput,
  client: PlaidApiClient = createPlaidClient()
): Promise<PlaidPublicTokenExchangeResult> {
  requirePlaidConfig();
  const publicToken = cleanString(input.publicToken);

  if (!publicToken) {
    throw new PlaidSetupError("public_token is required.");
  }

  const response = await client.itemPublicTokenExchange({ public_token: publicToken });
  const itemId = cleanString(response.data.item_id);
  const accessToken = cleanString(response.data.access_token);

  if (!itemId || !accessToken) {
    throw new PlaidSetupError("Plaid did not return an access token.", 502);
  }

  const items = await readStoredPlaidItems();
  const item: StoredPlaidItem = {
    accessToken,
    institutionId: cleanString(input.institutionId),
    institutionName: cleanString(input.institutionName) ?? plaidInstitutionName(cleanString(input.institutionId)),
    itemId,
    linkedAt: new Date().toISOString()
  };
  const nextItems = [...items.filter((candidate) => candidate.itemId !== itemId), item];

  await writeStoredPlaidItems(nextItems);

  const status = await getPlaidSetupStatus();
  const summary = status.items.find((candidate) => candidate.id === itemId) ?? {
    accountCount: 0,
    accounts: [],
    cursorPresent: false,
    id: itemId,
    institutionId: item.institutionId,
    institutionName: item.institutionName ?? plaidInstitutionName(item.institutionId),
    status: "connected",
    transactionCount: 0
  };

  return { item: summary, status };
}

export function syncPlaidData(): Promise<PlaidSyncResult> {
  return runServerEffect(syncPlaidDataEffect());
}

export function syncPlaidDataEffect(): Effect.Effect<PlaidSyncResult, PlaidSyncError, never> {
  return Effect.tryPromise({
    try: () => syncPlaidDataInternal(),
    catch: (error) =>
      new PlaidSyncError({
        cause: error,
        message: plaidErrorMessage(error, "Plaid sync failed.")
      })
  });
}

export async function syncPlaidDataForTests(client: PlaidApiClient): Promise<PlaidSyncResult> {
  return syncPlaidDataInternal(client);
}

export function isPlaidConfigured(env: WorkspaceEnv = readWorkspaceEnv()): boolean {
  return readPlaidConfig(env).configured;
}

export function skippedPlaidSyncResult(reason = "not_configured"): PlaidSyncResult {
  const now = new Date().toISOString();

  return {
    accountCount: 0,
    errors: reason === "not_configured" ? [] : [reason],
    itemCount: 0,
    lastSyncedAt: now,
    ok: true,
    removedTransactionCount: 0,
    status: {
      clientIdConfigured: false,
      configured: false,
      environment: "sandbox",
      itemCount: 0,
      items: [],
      readyForLink: false,
      readyForSync: false,
      redirectUriConfigured: false,
      secretConfigured: false,
      standbyInstitutionNames: [],
      storedAccountCount: 0,
      storedTransactionCount: 0
    },
    transactionCount: 0
  };
}

export async function getHealthyPlaidStandbyInstitutionIds(): Promise<Set<string>> {
  return healthyPlaidStandbyInstitutionIds(await readStoredPlaidItems());
}

export function encodeStoredPlaidItems(items: StoredPlaidItem[]): string {
  return Buffer.from(JSON.stringify(items), "utf8").toString("base64");
}

export function parseStoredPlaidItems(value: string | undefined): StoredPlaidItem[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => normalizeStoredPlaidItem(item));
  } catch {
    return [];
  }
}

export async function readStoredPlaidItems(): Promise<StoredPlaidItem[]> {
  const stored = await readSyncStateValue(plaidItemsStateKey);

  if (stored !== undefined) {
    return parseStoredPlaidItems(stored);
  }

  return seedStoredPlaidItemsFromEnv();
}

export function providerConnectionIdForPlaid(itemId: string): string {
  return `provider_plaid_${stableIdSuffix(itemId)}`;
}

export function accountIdForPlaid(accountId: string): string {
  return `plaid_acct_${stableIdSuffix(accountId)}`;
}

export function transactionIdForPlaid(transactionId: string): string {
  return `plaid_txn_${stableIdSuffix(transactionId)}`;
}

export function mapPlaidAccountToDomain({
  account,
  institutionName,
  itemId,
  syncedAt
}: {
  account: AccountBase;
  institutionName: string;
  itemId: string;
  syncedAt: string;
}): Account {
  const type = mapPlaidAccountType(account);
  const currentBalance = mapPlaidAccountBalance(account, type);

  return {
    id: accountIdForPlaid(account.account_id),
    providerConnectionId: providerConnectionIdForPlaid(itemId),
    groupId: groupIdForAccountType(type),
    name: cleanString(account.name) ?? cleanString(account.official_name) ?? "Plaid account",
    institutionName,
    type,
    mask: cleanString(account.mask),
    currency: normalizeProviderCurrencyCode(account.balances.iso_currency_code ?? account.balances.unofficial_currency_code),
    currentBalance,
    availableBalance: account.balances.available === null ? undefined : roundMoney(account.balances.available),
    includedInNetWorth: true,
    lastUpdatedAt: account.balances.last_updated_datetime ?? syncedAt
  };
}

export function mapPlaidTransactionToDomain({
  account,
  plaidTransaction,
  providerConnectionId
}: {
  account: Account;
  plaidTransaction: PlaidTransaction;
  providerConnectionId: string;
}): Transaction {
  const description =
    cleanString(plaidTransaction.original_description) ??
    cleanString(plaidTransaction.name) ??
    cleanString(plaidTransaction.merchant_name) ??
    "Plaid transaction";
  const merchantName =
    cleanString(plaidTransaction.merchant_name) ??
    cleanString(plaidTransaction.name) ??
    cleanString(plaidTransaction.original_description) ??
    "Plaid transaction";
  const amount = roundMoney(-plaidTransaction.amount);
  const categoryId = mapProviderTransactionCategory({
    accountType: account.type,
    amount,
    description,
    merchantName
  });

  return {
    id: transactionIdForPlaid(plaidTransaction.transaction_id),
    accountId: account.id,
    providerConnectionId,
    date: plaidTransaction.date,
    authorizedDate: plaidTransaction.authorized_date ?? undefined,
    postedDate: plaidTransaction.pending ? undefined : plaidTransaction.date,
    merchantName,
    description,
    amount,
    currency: normalizeProviderCurrencyCode(
      plaidTransaction.iso_currency_code ?? plaidTransaction.unofficial_currency_code ?? account.currency
    ),
    categoryId,
    status: plaidTransaction.pending ? "pending" : "posted",
    reviewed: false,
    tags: ["plaid"],
    pendingTransactionId: plaidTransaction.pending_transaction_id
      ? transactionIdForPlaid(plaidTransaction.pending_transaction_id)
      : undefined
  };
}

async function syncPlaidDataInternal(client: PlaidApiClient = createPlaidClient()): Promise<PlaidSyncResult> {
  const startedAt = new Date().toISOString();
  requirePlaidConfig();
  const items = await readStoredPlaidItems();
  const finishedAt = new Date().toISOString();
  const accounts: Account[] = [];
  const balanceSnapshots: AccountBalanceSnapshot[] = [];
  const errors: string[] = [];
  const providerConnections: ProviderConnection[] = [];
  const removedTransactionIds: string[] = [];
  const successfulProviderConnectionIds: string[] = [];
  const transactions: Transaction[] = [];
  const nextItems: StoredPlaidItem[] = [];

  for (const item of items) {
    const institutionName = item.institutionName ?? plaidInstitutionName(item.institutionId);
    const providerConnectionId = providerConnectionIdForPlaid(item.itemId);

    try {
      const itemSync = await syncPlaidItem({
        client,
        item,
        institutionName,
        syncedAt: finishedAt
      });

      accounts.push(...itemSync.accounts);
      balanceSnapshots.push(...itemSync.balanceSnapshots);
      removedTransactionIds.push(...itemSync.removedTransactionIds);
      transactions.push(...itemSync.transactions);
      successfulProviderConnectionIds.push(providerConnectionId);
      providerConnections.push({
        configured: true,
        displayName: `Plaid - ${institutionName}`,
        id: providerConnectionId,
        lastSyncedAt: finishedAt,
        provider: "plaid",
        status: "connected"
      });
      nextItems.push({
        ...item,
        errorMessage: undefined,
        institutionName,
        lastSyncedAt: finishedAt,
        nextCursor: itemSync.nextCursor
      });
    } catch (error) {
      const errorMessage = `${institutionName}: ${plaidErrorMessage(error, "sync failed")}`;
      errors.push(errorMessage);
      providerConnections.push({
        configured: true,
        displayName: `Plaid - ${institutionName}`,
        errorMessage,
        id: providerConnectionId,
        lastSyncedAt: item.lastSyncedAt,
        provider: "plaid",
        status: "error"
      });
      nextItems.push({
        ...item,
        errorMessage,
        institutionName
      });
    }
  }

  const record = await replacePlaidLedgerSnapshot({
    accounts: dedupeById(accounts),
    balanceSnapshots: dedupeById(balanceSnapshots),
    errors,
    finishedAt,
    providerConnections,
    removedTransactionIds,
    startedAt,
    successfulProviderConnectionIds,
    syncState: {
      [plaidItemsStateKey]: encodeStoredPlaidItems(nextItems)
    },
    transactions: dedupeById(transactions).sort((left, right) => right.date.localeCompare(left.date))
  });

  invalidateShellDataCache();

  return {
    accountCount: record.accountCount,
    errors,
    itemCount: providerConnections.length,
    lastSyncedAt: record.lastSyncedAt,
    ok: errors.length === 0,
    removedTransactionCount: record.removedTransactionCount,
    status: await getPlaidSetupStatus(),
    transactionCount: record.transactionCount
  };
}

async function syncPlaidItem({
  client,
  institutionName,
  item,
  syncedAt
}: {
  client: PlaidApiClient;
  institutionName: string;
  item: StoredPlaidItem;
  syncedAt: string;
}): Promise<PlaidItemSyncPageSet> {
  const accountByPlaidId = new Map<string, Account>();
  const removedTransactionIds: string[] = [];
  const transactions: Transaction[] = [];
  let cursor = item.nextCursor;
  let nextCursor = item.nextCursor;
  let hasMore = true;

  while (hasMore) {
    const response = await client.transactionsSync({
      access_token: item.accessToken,
      count: 500,
      cursor,
      options: {
        include_original_description: true
      }
    });
    const data = response.data;

    for (const plaidAccount of data.accounts) {
      const account = mapPlaidAccountToDomain({
        account: plaidAccount,
        institutionName,
        itemId: item.itemId,
        syncedAt
      });
      accountByPlaidId.set(plaidAccount.account_id, account);
    }

    for (const plaidTransaction of [...data.added, ...data.modified]) {
      const account = accountByPlaidId.get(plaidTransaction.account_id);

      if (!account) {
        continue;
      }

      transactions.push(
        mapPlaidTransactionToDomain({
          account,
          plaidTransaction,
          providerConnectionId: providerConnectionIdForPlaid(item.itemId)
        })
      );
    }

    removedTransactionIds.push(...data.removed.map((transaction) => removedTransactionIdForPlaid(transaction)));
    nextCursor = cleanString(data.next_cursor) ?? nextCursor;
    cursor = nextCursor;
    hasMore = data.has_more;
  }

  const accounts = [...accountByPlaidId.values()];

  return {
    accounts,
    balanceSnapshots: accounts.map((account) => createPlaidBalanceSnapshot(account, syncedAt)),
    nextCursor,
    removedTransactionIds,
    transactions
  };
}

function removedTransactionIdForPlaid(transaction: RemovedTransaction): string {
  return transactionIdForPlaid(transaction.transaction_id);
}

async function seedStoredPlaidItemsFromEnv(): Promise<StoredPlaidItem[]> {
  const env = readWorkspaceEnv();
  const encoded = cleanString(env.PLAID_ITEMS_B64);

  if (!encoded) {
    return [];
  }

  const items = parseSeedPlaidItems(encoded);

  if (items.length > 0) {
    await writeStoredPlaidItems(items);
  }

  return items;
}

function parseSeedPlaidItems(value: string): StoredPlaidItem[] {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    const linkedAt = new Date().toISOString();
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const record = item as Record<string, unknown>;
      const itemId = readStringField(record, "item_id") ?? readStringField(record, "itemId");
      const accessToken = readStringField(record, "access_token") ?? readStringField(record, "accessToken");
      const institutionId = readStringField(record, "institution_id") ?? readStringField(record, "institutionId");

      return itemId && accessToken
        ? [
            {
              accessToken,
              institutionId,
              institutionName: plaidInstitutionName(institutionId),
              itemId,
              linkedAt
            } satisfies StoredPlaidItem
          ]
        : [];
    });
  } catch {
    return [];
  }
}

async function writeStoredPlaidItems(items: StoredPlaidItem[]): Promise<void> {
  await writeSyncStateValue(plaidItemsStateKey, encodeStoredPlaidItems(dedupeByItemId(items)));
}

function normalizeStoredPlaidItem(value: unknown): StoredPlaidItem[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const itemId = readStringField(record, "itemId") ?? readStringField(record, "item_id");
  const accessToken = readStringField(record, "accessToken") ?? readStringField(record, "access_token");
  const linkedAt = readStringField(record, "linkedAt") ?? readStringField(record, "linked_at") ?? new Date(0).toISOString();

  if (!itemId || !accessToken) {
    return [];
  }

  const institutionId = readStringField(record, "institutionId") ?? readStringField(record, "institution_id");

  return [
    {
      accessToken,
      errorMessage: readStringField(record, "errorMessage") ?? readStringField(record, "error_message"),
      institutionId,
      institutionName:
        readStringField(record, "institutionName") ??
        readStringField(record, "institution_name") ??
        plaidInstitutionName(institutionId),
      itemId,
      lastSyncedAt: readStringField(record, "lastSyncedAt") ?? readStringField(record, "last_synced_at"),
      linkedAt,
      nextCursor: readStringField(record, "nextCursor") ?? readStringField(record, "next_cursor")
    }
  ];
}

function createPlaidClient(config: PlaidConfig = requirePlaidConfig()): PlaidApi {
  return new PlaidApi(
    new Configuration({
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": config.clientId,
          "PLAID-SECRET": config.secret
        }
      },
      basePath: PlaidEnvironments[config.environment]
    })
  );
}

function readPlaidConfig(env: WorkspaceEnv = readWorkspaceEnv()): PlaidConfig {
  const environment = normalizePlaidEnvironment(env.PLAID_ENV);
  const clientId = cleanString(env.PLAID_CLIENT_ID);
  const secret = cleanString(env.PLAID_SECRET) ?? (environment === "sandbox" ? cleanString(env.PLAID_SANDBOX_SECRET) : undefined);
  const redirectUri = cleanString(env.PLAID_REDIRECT_URI);

  return {
    clientId,
    configured: hasValue(clientId) && hasValue(secret),
    environment,
    redirectUri,
    secret
  };
}

function requirePlaidConfig(env: WorkspaceEnv = readWorkspaceEnv()): Required<PlaidConfig> {
  const config = readPlaidConfig(env);

  if (!hasValue(config.clientId)) {
    throw new PlaidSetupError("PLAID_CLIENT_ID is missing in the ignored local .env file.");
  }

  if (!hasValue(config.secret)) {
    throw new PlaidSetupError("PLAID_SECRET is missing in the ignored local .env file.");
  }

  return {
    ...config,
    clientId: config.clientId,
    redirectUri: config.redirectUri ?? "",
    secret: config.secret
  };
}

function normalizePlaidEnvironment(value: string | undefined): PlaidEnvironmentName {
  return value?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

function mapPlaidAccountType(account: AccountBase): AccountType {
  if (account.type === "credit" && account.subtype === "credit card") {
    return "credit_card";
  }

  if (account.type === "depository" && account.subtype === "checking") {
    return "checking";
  }

  if (account.type === "depository" && account.subtype === "savings") {
    return "savings";
  }

  if (account.type === "loan") {
    return "loan";
  }

  if (account.type === "investment" || account.type === "brokerage") {
    return "investment";
  }

  return "cash";
}

function mapPlaidAccountBalance(account: AccountBase, accountType: AccountType): number {
  const current = account.balances.current ?? account.balances.available ?? 0;

  if (accountType === "credit_card" || accountType === "loan") {
    return -Math.abs(roundMoney(current));
  }

  return roundMoney(current);
}

function createPlaidBalanceSnapshot(account: Account, syncedAt: string): AccountBalanceSnapshot {
  return {
    id: `${account.id}_${syncedAt.replace(/[^0-9a-z]/gi, "")}`,
    accountId: account.id,
    asOfDate: syncedAt.slice(0, 10),
    capturedAt: syncedAt,
    ledgerBalance: account.currentBalance,
    availableBalance: account.availableBalance,
    currency: account.currency,
    source: "plaid"
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

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function dedupeByItemId(items: StoredPlaidItem[]): StoredPlaidItem[] {
  return Array.from(new Map(items.map((item) => [item.itemId, item])).values());
}

function cleanString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function readStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field : undefined;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function stableIdSuffix(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

function latestIso(values: string[]): string | undefined {
  return values
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => right.localeCompare(left))[0];
}

function plaidErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PlaidSetupError) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const response = (error as { response?: { status?: number } }).response;

    if (response?.status) {
      return `Plaid API returned HTTP ${response.status}.`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
