import { createHash, randomBytes } from "node:crypto";
import type { Account, InvestmentPosition, ProviderConnection } from "@ai-finances/schema";
import {
  type Account as SnapTradeAccount,
  type AccountPosition,
  type BrokerageAuthorization,
  type Instrument,
  Snaptrade,
  SnaptradeError
} from "snaptrade-typescript-sdk";
import {
  deleteSyncStateValue,
  listInvestmentPositions,
  readFinanceDbSnapshot,
  readSyncStateValue,
  replaceSnapTradeInvestmentSnapshot,
  upsertAccountBalanceSnapshots,
  writeSyncStateValue
} from "@/lib/db/finance-db";
import { SnapTradeSyncError } from "@/lib/effect/sync-errors";
import { runServerEffect } from "@/lib/effect/runtime";
import { type AccountBalanceSnapshot, invalidateShellDataCache } from "@/lib/finance-data";
import { normalizeProviderCurrencyCode } from "@/lib/currency";
import { readWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";
import { Effect } from "effect";

export interface StoredSnapTradeUser {
  registeredAt: string;
  userId: string;
  userSecret: string;
}

export interface SnapTradeConnectionAccountSummary {
  currency: string;
  currentBalance: number;
  id: string;
  mask?: string;
  name: string;
  type: "investment";
}

export interface SnapTradeConnectionSummary {
  accountCount: number;
  accounts: SnapTradeConnectionAccountSummary[];
  brokerageName?: string;
  createdAt?: string;
  disabled: boolean;
  errorMessage?: string;
  id: string;
  lastSyncedAt?: string;
  name: string;
  status: ProviderConnection["status"];
  type?: string;
}

export interface SnapTradeSetupStatus {
  clientIdConfigured: boolean;
  configured: boolean;
  connectionCount: number;
  connections: SnapTradeConnectionSummary[];
  consumerKeyConfigured: boolean;
  errorMessage?: string;
  lastSyncedAt?: string;
  readyForConnect: boolean;
  readyForSync: boolean;
  registered: boolean;
  storedAccountCount: number;
  storedPositionCount: number;
}

export interface SnapTradeConnectionPortal {
  expiresInSeconds: number;
  redirectUri: string;
  sessionId?: string;
  status: SnapTradeSetupStatus;
}

export interface SnapTradeSyncResult {
  accountCount: number;
  connectionCount: number;
  errors: string[];
  lastSyncedAt: string;
  ok: boolean;
  positionCount: number;
  status: SnapTradeSetupStatus;
}

interface SnapTradeConfig {
  clientId?: string;
  consumerKey?: string;
  configured: boolean;
}

export class SnapTradeSetupError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export const snapTradeUserStateKey = "snaptrade_user_v1";
const snapTradePendingUserIdStateKey = "snaptrade_pending_user_id_v1";

export async function getSnapTradeSetupStatus(): Promise<SnapTradeSetupStatus> {
  const env = readWorkspaceEnv();
  const config = readSnapTradeConfig(env);
  const storedUser = await readStoredSnapTradeUser();
  const localSnapshot = await readFinanceDbSnapshot();
  const localConnections = (localSnapshot?.providerConnections ?? []).filter(
    (connection) => connection.provider === "snaptrade"
  );
  const localConnectionIds = new Set(localConnections.map((connection) => connection.id));
  const localAccounts = (localSnapshot?.accounts ?? []).filter((account) =>
    localConnectionIds.has(account.providerConnectionId)
  );
  const positions = await listInvestmentPositions(localAccounts.map((account) => account.id));
  const accountsByConnection = groupAccountsByConnection(localAccounts);
  const localConnectionById = new Map(localConnections.map((connection) => [connection.id, connection]));
  let apiConnections: BrokerageAuthorization[] = [];
  let listedConnections = false;
  let errorMessage: string | undefined;

  if (config.configured && storedUser) {
    try {
      apiConnections = (await createSnapTradeClient(config).connections.listBrokerageAuthorizations({
        userId: storedUser.userId,
        userSecret: storedUser.userSecret
      })).data;
      listedConnections = true;
    } catch (error) {
      errorMessage = snapTradeErrorMessage(error, "Unable to list SnapTrade connections.");
    }
  }

  const connections =
    listedConnections
      ? apiConnections.flatMap((connection) =>
          connection.id
            ? [
                summarizeSnapTradeConnection({
                  accounts: accountsByConnection.get(providerConnectionIdForSnapTrade(connection.id)) ?? [],
                  connection,
                  localConnection: localConnectionById.get(providerConnectionIdForSnapTrade(connection.id))
                })
              ]
            : []
        )
      : localConnections.map((connection) => ({
          accountCount: accountsByConnection.get(connection.id)?.length ?? 0,
          accounts: accountsByConnection.get(connection.id) ?? [],
          disabled: connection.status === "error",
          errorMessage: errorMessage ?? connection.errorMessage,
          id: connection.id,
          lastSyncedAt: connection.lastSyncedAt,
          name: connection.displayName.replace(/^SnapTrade -\s*/, ""),
          status: errorMessage ? "error" : connection.status
        } satisfies SnapTradeConnectionSummary));
  const lastSyncedAt = latestIso(localConnections.flatMap((connection) => connection.lastSyncedAt ?? []));

  return {
    clientIdConfigured: hasValue(config.clientId),
    configured: config.configured,
    connectionCount: connections.length,
    connections,
    consumerKeyConfigured: hasValue(config.consumerKey),
    errorMessage,
    lastSyncedAt,
    readyForConnect: config.configured,
    readyForSync: config.configured && storedUser !== undefined,
    registered: storedUser !== undefined,
    storedAccountCount: localAccounts.length,
    storedPositionCount: positions.length
  };
}

export async function createSnapTradeConnectionPortal(): Promise<SnapTradeConnectionPortal> {
  const env = readWorkspaceEnv();
  const config = requireSnapTradeConfig(env);
  const client = createSnapTradeClient(config);
  const user = await ensureStoredSnapTradeUser(client);
  const response = await client.authentication.loginSnapTradeUser({
    userId: user.userId,
    userSecret: user.userSecret,
    connectionType: "read",
    connectionPortalVersion: "v4",
    showCloseButton: true
  });
  const redirectUri = readRedirectUri(response.data);

  if (!redirectUri) {
    throw new SnapTradeSetupError("SnapTrade did not return a connection portal URL.", 502);
  }

  return {
    expiresInSeconds: 5 * 60,
    redirectUri,
    sessionId: readStringField(response.data, "sessionId"),
    status: await getSnapTradeSetupStatus()
  };
}

export function syncSnapTradeData(): Promise<SnapTradeSyncResult> {
  return runServerEffect(syncSnapTradeDataEffect());
}

export function syncSnapTradeDataEffect(): Effect.Effect<SnapTradeSyncResult, SnapTradeSyncError, never> {
  return Effect.tryPromise({
    try: syncSnapTradeDataInternal,
    catch: (error) =>
      new SnapTradeSyncError({
        cause: error,
        message: snapTradeErrorMessage(error, "SnapTrade sync failed.")
      })
  });
}

export function skippedSnapTradeSyncResult(): SnapTradeSyncResult {
  return {
    accountCount: 0,
    connectionCount: 0,
    errors: [],
    lastSyncedAt: new Date().toISOString(),
    ok: true,
    positionCount: 0,
    status: {
      clientIdConfigured: false,
      configured: false,
      connectionCount: 0,
      connections: [],
      consumerKeyConfigured: false,
      readyForConnect: false,
      readyForSync: false,
      registered: false,
      storedAccountCount: 0,
      storedPositionCount: 0
    }
  };
}

export function isSnapTradeConfigured(env: WorkspaceEnv = readWorkspaceEnv()): boolean {
  return readSnapTradeConfig(env).configured;
}

async function syncSnapTradeDataInternal(): Promise<SnapTradeSyncResult> {
  const startedAt = new Date().toISOString();
  const config = requireSnapTradeConfig();
  const client = createSnapTradeClient(config);
  const user = await ensureStoredSnapTradeUser(client);
  const connections = (await client.connections.listBrokerageAuthorizations({
    userId: user.userId,
    userSecret: user.userSecret
  })).data;
  const finishedAt = new Date().toISOString();
  const accounts: Account[] = [];
  const balanceSnapshots: AccountBalanceSnapshot[] = [];
  const positions: InvestmentPosition[] = [];
  const providerConnections: ProviderConnection[] = [];
  const successfulProviderConnectionIds: string[] = [];
  const positionAccountIds: string[] = [];
  const backfillAccounts: SnapTradeBalanceBackfillAccount[] = [];
  const errors: string[] = [];

  for (const connection of connections) {
    const connectionId = connection.id;

    if (!connectionId) {
      errors.push("SnapTrade returned a connection without an id.");
      continue;
    }

    const providerConnectionId = providerConnectionIdForSnapTrade(connectionId);
    const brokerageName = snapTradeConnectionBrokerageName(connection);
    const connectionError = connection.disabled ? `${brokerageName} connection is disabled in SnapTrade.` : undefined;

    if (connectionError) {
      errors.push(connectionError);
    }

    providerConnections.push({
      id: providerConnectionId,
      provider: "snaptrade",
      displayName: `SnapTrade - ${brokerageName}`,
      status: connection.disabled ? "error" : "connected",
      configured: true,
      lastSyncedAt: finishedAt,
      errorMessage: connectionError
    });

    let snapTradeAccounts: SnapTradeAccount[] = [];
    try {
      snapTradeAccounts = (await client.connections.listBrokerageAuthorizationAccounts({
        authorizationId: connectionId,
        userId: user.userId,
        userSecret: user.userSecret
      })).data;
      successfulProviderConnectionIds.push(providerConnectionId);
    } catch (error) {
      errors.push(`${brokerageName}: ${snapTradeErrorMessage(error, "account list failed")}`);
      continue;
    }

    for (const snapTradeAccount of snapTradeAccounts) {
      const account = mapSnapTradeAccountToDomain({
        account: snapTradeAccount,
        providerConnectionId,
        syncedAt: finishedAt
      });

      if (!account) {
        errors.push(`${snapTradeAccount.name ?? snapTradeAccount.id}: missing total account balance.`);
        continue;
      }

      accounts.push(account);
      balanceSnapshots.push(createSnapTradeBalanceSnapshot(account, finishedAt));
      backfillAccounts.push({ accountId: account.id, snapTradeAccountId: snapTradeAccount.id });

      try {
        const positionsResponse = await client.accountInformation.getAllAccountPositions({
          accountId: snapTradeAccount.id,
          userId: user.userId,
          userSecret: user.userSecret
        });
        positionAccountIds.push(account.id);

        for (const position of positionsResponse.data.results) {
          const mapped = mapSnapTradePositionToDomain({
            accountId: account.id,
            position
          });

          if (mapped) {
            positions.push(mapped);
          } else {
            errors.push(`${account.name}: skipped a position with missing units or price.`);
          }
        }
      } catch (error) {
        errors.push(`${account.name}: ${snapTradeErrorMessage(error, "position sync failed")}`);
      }
    }
  }

  const record = await replaceSnapTradeInvestmentSnapshot({
    accounts,
    balanceSnapshots,
    errors,
    finishedAt,
    positionAccountIds,
    positions,
    providerConnections,
    startedAt,
    successfulProviderConnectionIds
  });

  // Top up daily historical account-value points from SnapTrade's experimental
  // balanceHistory endpoint. Runs after accounts are committed so the snapshot
  // rows satisfy the accounts foreign key. Never fails the sync: a disabled
  // endpoint or per-account error degrades to a logged no-op.
  await backfillSnapTradeBalanceHistory({ accounts: backfillAccounts, client, user });

  invalidateShellDataCache();

  return {
    ok: errors.length === 0,
    accountCount: record.accountCount,
    connectionCount: record.connectionCount,
    errors,
    lastSyncedAt: record.lastSyncedAt,
    positionCount: record.positionCount,
    status: await getSnapTradeSetupStatus()
  };
}

export function mapSnapTradeAccountToDomain({
  account,
  providerConnectionId,
  syncedAt
}: {
  account: SnapTradeAccount;
  providerConnectionId: string;
  syncedAt: string;
}): Account | null {
  const total = account.balance?.total;
  const totalAmount = toFiniteNumber(total?.amount);

  if (totalAmount === undefined) {
    return null;
  }

  const name = cleanString(account.name) ?? "Investment account";
  const institutionName = cleanString(account.institution_name) ?? "SnapTrade brokerage";

  return {
    id: accountIdForSnapTrade(account.id),
    providerConnectionId,
    groupId: "group_investments",
    name,
    institutionName,
    type: "investment",
    mask: maskAccountNumber(account.number),
    currency: normalizeProviderCurrencyCode(total?.currency),
    currentBalance: roundMoney(totalAmount),
    includedInNetWorth: true,
    lastUpdatedAt: syncedAt
  };
}

export function mapSnapTradePositionToDomain({
  accountId,
  position
}: {
  accountId: string;
  position: AccountPosition;
}): InvestmentPosition | null {
  const units = parseDecimal(position.units);
  const price = parseDecimal(position.price);

  if (units === undefined || price === undefined) {
    return null;
  }

  const instrument = position.instrument;
  const symbol = instrumentSymbol(instrument);
  const description = cleanString(readStringField(instrument, "description")) ?? symbol;
  const currency = normalizeProviderCurrencyCode(position.currency ?? readStringField(instrument, "currency"));
  // `cost_basis` is the average purchase price *per share/unit* (per-contract for
  // options) — not the total book cost. Persist it so the UI can derive unrealized
  // gain/loss as (price − cost_basis) × units. Absent for some brokerages/positions.
  const costBasis = parseDecimal(position.cost_basis);

  return {
    id: investmentPositionId(accountId, instrument, symbol, description),
    accountId,
    symbol,
    description,
    units,
    price,
    costBasis,
    currency,
    marketValue: roundMoney(units * price)
  };
}

export function providerConnectionIdForSnapTrade(authorizationId: string): string {
  return `provider_snaptrade_${stableIdSuffix(authorizationId)}`;
}

export function accountIdForSnapTrade(accountId: string): string {
  return `snaptrade_acct_${stableIdSuffix(accountId)}`;
}

async function ensureStoredSnapTradeUser(client: Snaptrade): Promise<StoredSnapTradeUser> {
  const existing = await readStoredSnapTradeUser();

  if (existing) {
    return existing;
  }

  const pendingUserId = await readSyncStateValue(snapTradePendingUserIdStateKey);
  const userId = pendingUserId ?? createSnapTradeUserId();

  if (!pendingUserId) {
    await writeSyncStateValue(snapTradePendingUserIdStateKey, userId);
  }

  try {
    const response = await client.authentication.registerSnapTradeUser({ userId });
    const userSecret = response.data.userSecret;

    if (!response.data.userId || !userSecret) {
      throw new SnapTradeSetupError("SnapTrade did not return a user secret.", 502);
    }

    const storedUser = {
      registeredAt: new Date().toISOString(),
      userId: response.data.userId,
      userSecret
    };

    await writeSyncStateValue(snapTradeUserStateKey, encodeStoredSnapTradeUser(storedUser));
    await deleteSyncStateValue(snapTradePendingUserIdStateKey);
    return storedUser;
  } catch (error) {
    if (isSnapTradeAlreadyExistsError(error)) {
      throw new SnapTradeSetupError(
        "SnapTrade says the generated local user already exists, but this app does not have the one-time user secret. Reset that SnapTrade user in the SnapTrade dashboard or clear the pending SnapTrade sync state before retrying.",
        409
      );
    }

    throw error;
  }
}

async function readStoredSnapTradeUser(): Promise<StoredSnapTradeUser | undefined> {
  const stored = parseStoredSnapTradeUser(await readSyncStateValue(snapTradeUserStateKey));

  if (stored) {
    return stored;
  }

  return seedStoredSnapTradeUserFromEnv();
}

// One-time seed, like CHATGPT_OAUTH_TOKENS_B64: adopts a pre-existing SnapTrade
// user (e.g. created through the SnapTrade dashboard) so its brokerage
// connections are reused instead of registering a fresh user with none.
// DB storage is the source of truth afterwards.
async function seedStoredSnapTradeUserFromEnv(): Promise<StoredSnapTradeUser | undefined> {
  const env = readWorkspaceEnv();
  const userId = cleanString(env.SNAPTRADE_USER_ID);
  const userSecret = cleanString(env.SNAPTRADE_USER_SECRET);

  if (!userId || !userSecret) {
    return undefined;
  }

  const storedUser = {
    registeredAt: new Date().toISOString(),
    userId,
    userSecret
  };

  await writeSyncStateValue(snapTradeUserStateKey, encodeStoredSnapTradeUser(storedUser));
  return storedUser;
}

export function encodeStoredSnapTradeUser(user: StoredSnapTradeUser): string {
  return Buffer.from(JSON.stringify(user), "utf8").toString("base64");
}

export function parseStoredSnapTradeUser(value: string | undefined): StoredSnapTradeUser | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Partial<StoredSnapTradeUser>;

    if (
      typeof parsed.userId === "string" &&
      parsed.userId.length > 0 &&
      typeof parsed.userSecret === "string" &&
      parsed.userSecret.length > 0 &&
      typeof parsed.registeredAt === "string"
    ) {
      return {
        registeredAt: parsed.registeredAt,
        userId: parsed.userId,
        userSecret: parsed.userSecret
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function createSnapTradeClient(config: SnapTradeConfig): Snaptrade {
  return new Snaptrade({
    clientId: config.clientId,
    consumerKey: config.consumerKey
  });
}

function readSnapTradeConfig(env: WorkspaceEnv = readWorkspaceEnv()): SnapTradeConfig {
  const clientId = cleanString(env.SNAPTRADE_CLIENT_ID);
  const consumerKey = cleanString(env.SNAPTRADE_CONSUMER_KEY);

  return {
    clientId,
    consumerKey,
    configured: hasValue(clientId) && hasValue(consumerKey)
  };
}

function requireSnapTradeConfig(env: WorkspaceEnv = readWorkspaceEnv()): SnapTradeConfig {
  const config = readSnapTradeConfig(env);

  if (!hasValue(config.clientId)) {
    throw new SnapTradeSetupError("SNAPTRADE_CLIENT_ID is missing in the ignored local .env file.");
  }

  if (!hasValue(config.consumerKey)) {
    throw new SnapTradeSetupError("SNAPTRADE_CONSUMER_KEY is missing in the ignored local .env file.");
  }

  return config;
}

function summarizeSnapTradeConnection({
  accounts,
  connection,
  localConnection
}: {
  accounts: SnapTradeConnectionAccountSummary[];
  connection: BrokerageAuthorization;
  localConnection?: ProviderConnection;
}): SnapTradeConnectionSummary {
  const brokerageName = snapTradeConnectionBrokerageName(connection);
  const disabled = connection.disabled === true;

  return {
    accountCount: accounts.length,
    accounts,
    brokerageName,
    createdAt: connection.created_date,
    disabled,
    errorMessage: disabled ? `${brokerageName} connection is disabled in SnapTrade.` : localConnection?.errorMessage,
    id: connection.id ?? "",
    lastSyncedAt: localConnection?.lastSyncedAt,
    name: cleanString(connection.name) ?? brokerageName,
    status: disabled ? "error" : localConnection?.status ?? "connected",
    type: connection.type
  };
}

function groupAccountsByConnection(accounts: Account[]): Map<string, SnapTradeConnectionAccountSummary[]> {
  const result = new Map<string, SnapTradeConnectionAccountSummary[]>();

  for (const account of accounts) {
    const list = result.get(account.providerConnectionId) ?? [];
    list.push({
      currency: account.currency,
      currentBalance: account.currentBalance,
      id: account.id,
      mask: account.mask,
      name: account.name,
      type: "investment"
    });
    result.set(account.providerConnectionId, list);
  }

  return result;
}

function createSnapTradeBalanceSnapshot(account: Account, syncedAt: string): AccountBalanceSnapshot {
  return {
    id: `${account.id}_${syncedAt.replace(/[^0-9a-z]/gi, "")}`,
    accountId: account.id,
    asOfDate: syncedAt.slice(0, 10),
    capturedAt: syncedAt,
    ledgerBalance: account.currentBalance,
    currency: account.currency,
    source: "snaptrade"
  };
}

export const snapTradeBalanceBackfillSource = "snaptrade_backfill";

export interface SnapTradeBalanceBackfillAccount {
  accountId: string;
  snapTradeAccountId: string;
}

export interface SnapTradeBalanceBackfillAccountResult {
  accountId: string;
  error?: string;
  points: number;
}

export interface SnapTradeBalanceBackfillResult {
  attemptedAccounts: number;
  disabled: boolean;
  perAccount: SnapTradeBalanceBackfillAccountResult[];
  pointsWritten: number;
}

/**
 * Fetch SnapTrade's experimental daily account-value history for each linked
 * investment account and idempotently upsert one snapshot per account per date
 * (source `snaptrade_backfill`), leaving live intraday `snaptrade` captures
 * intact. Guarded so a disabled endpoint or per-account failure never throws —
 * it degrades to a logged no-op and returns the honest per-account counts.
 */
export async function backfillSnapTradeBalanceHistory({
  accounts,
  client,
  user
}: {
  accounts: SnapTradeBalanceBackfillAccount[];
  client: Snaptrade;
  user: StoredSnapTradeUser;
}): Promise<SnapTradeBalanceBackfillResult> {
  const perAccount: SnapTradeBalanceBackfillAccountResult[] = [];
  const snapshots: AccountBalanceSnapshot[] = [];
  let disabled = false;

  for (const { accountId, snapTradeAccountId } of accounts) {
    try {
      const response = await client.accountInformation.getAccountBalanceHistory({
        accountId: snapTradeAccountId,
        userId: user.userId,
        userSecret: user.userSecret
      });
      const accountSnapshots = mapSnapTradeBalanceHistory({
        accountId,
        currency: response.data?.currency,
        history: response.data?.history
      });

      if (isAllZeroBalanceHistory(accountSnapshots)) {
        console.warn(
          `SnapTrade balance backfill: account ${accountId} returned an all-zero history ` +
            `(${accountSnapshots.length} day(s)); provider returned no usable estimate, skipping ingestion.`
        );
        perAccount.push({
          accountId,
          points: 0,
          error: "provider returned no usable estimate (all-zero balance history)"
        });
        continue;
      }

      snapshots.push(...accountSnapshots);
      perAccount.push({ accountId, points: accountSnapshots.length });
    } catch (error) {
      if (isSnapTradeBalanceHistoryDisabled(error)) {
        disabled = true;
        perAccount.push({ accountId, points: 0, error: "balanceHistory endpoint disabled" });
        continue;
      }

      perAccount.push({
        accountId,
        points: 0,
        error: snapTradeErrorMessage(error, "balance history fetch failed")
      });
    }
  }

  let pointsWritten = 0;

  try {
    pointsWritten = await upsertAccountBalanceSnapshots(snapshots);
  } catch (error) {
    console.warn(`SnapTrade balance backfill upsert failed: ${snapTradeErrorMessage(error, "upsert failed")}`);
  }

  if (disabled) {
    console.warn(
      "SnapTrade getAccountBalanceHistory is disabled for this client; balance backfill degraded to a no-op. " +
        "Request enablement of the balanceHistory endpoint for SNAPTRADE_CLIENT_ID from SnapTrade support."
    );
  }

  return { attemptedAccounts: accounts.length, disabled, perAccount, pointsWritten };
}

/**
 * Map a SnapTrade balanceHistory response into balance snapshots, one per
 * distinct history date. Ids are deterministic (`<accountId>_backfill_<date>`)
 * so repeated backfills upsert in place. Items with a malformed date or a
 * non-finite value are dropped rather than fabricated.
 */
export function mapSnapTradeBalanceHistory({
  accountId,
  currency,
  history
}: {
  accountId: string;
  currency?: string | null;
  history?: Array<{ date?: string; total_value?: string | number | null }> | null;
}): AccountBalanceSnapshot[] {
  if (!Array.isArray(history)) {
    return [];
  }

  const normalizedCurrency = normalizeProviderCurrencyCode(currency ?? undefined);
  const byDate = new Map<string, AccountBalanceSnapshot>();

  for (const item of history) {
    const date = cleanString(item?.date);
    const value = parseDecimal(item?.total_value ?? undefined);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || value === undefined) {
      continue;
    }

    byDate.set(date, {
      id: `${accountId}_backfill_${date.replace(/-/g, "")}`,
      accountId,
      asOfDate: date,
      capturedAt: `${date}T00:00:00.000Z`,
      ledgerBalance: roundMoney(value),
      currency: normalizedCurrency,
      source: snapTradeBalanceBackfillSource
    });
  }

  return [...byDate.values()];
}

/**
 * True when a mapped balance history has at least one point and every point is
 * exactly zero. SnapTrade returns a flat all-zero series for some account
 * types (observed on RSU/ESPP-style accounts) when it cannot produce a
 * historical estimate at all — that means "cannot estimate", not "worth
 * zero", so callers should treat it as no usable data rather than ingest it.
 * A history that is zero on some dates but not others is left untouched:
 * partial zeros are plausible real values (e.g. a newly opened or emptied
 * account) and are not evidence of a provider limitation.
 */
function isAllZeroBalanceHistory(history: AccountBalanceSnapshot[]): boolean {
  return history.length > 0 && history.every((snapshot) => snapshot.ledgerBalance === 0);
}

function isSnapTradeBalanceHistoryDisabled(error: unknown): boolean {
  if (!(error instanceof SnaptradeError)) {
    return false;
  }

  if (error.status === 402 || error.status === 403 || error.status === 501) {
    return true;
  }

  const body = JSON.stringify(error.responseBody ?? "").toLowerCase();
  return body.includes("not enabled") || body.includes("disabled") || body.includes("feature");
}

function readRedirectUri(value: unknown): string | undefined {
  return readStringField(value, "redirectURI") ?? readStringField(value, "redirectUri");
}

function snapTradeConnectionBrokerageName(connection: BrokerageAuthorization): string {
  return (
    cleanString(connection.brokerage?.display_name) ??
    cleanString(connection.brokerage?.name) ??
    cleanString(connection.brokerage?.slug) ??
    cleanString(connection.name) ??
    "Brokerage"
  );
}

function instrumentSymbol(instrument: Instrument): string {
  return (
    cleanString(readStringField(instrument, "symbol")) ??
    cleanString(readStringField(instrument, "raw_symbol")) ??
    cleanString(readStringField(instrument, "id")) ??
    "UNKNOWN"
  );
}

function investmentPositionId(
  accountId: string,
  instrument: Instrument,
  symbol: string,
  description: string
): string {
  return `snaptrade_pos_${stableIdSuffix([
    accountId,
    readStringField(instrument, "id") ?? symbol,
    symbol,
    description
  ].join(":"))}`;
}

function maskAccountNumber(value: string | null | undefined): string | undefined {
  const trimmed = cleanString(value);

  if (!trimmed) {
    return undefined;
  }

  const trailingDigits = trimmed.match(/(\d{1,4})\D*$/)?.[1];

  if (trailingDigits) {
    return trailingDigits;
  }

  const compact = trimmed.replace(/\s+/g, "");
  return compact.slice(-4);
}

function createSnapTradeUserId(): string {
  return `ai-finances-${randomBytes(9).toString("base64url").toLowerCase()}`;
}

function parseDecimal(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cleanString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
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

function snapTradeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SnapTradeSetupError) {
    return error.message;
  }

  if (error instanceof SnaptradeError) {
    return error.status ? `SnapTrade API returned HTTP ${error.status}.` : fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function isSnapTradeAlreadyExistsError(error: unknown): boolean {
  const text =
    error instanceof SnaptradeError
      ? JSON.stringify(error.responseBody ?? "").toLowerCase()
      : error instanceof Error
        ? error.message.toLowerCase()
        : "";

  return text.includes("already") && text.includes("exist");
}
