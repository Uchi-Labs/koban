import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:https";
import path from "node:path";
import type { Account, AccountType, ProviderConnection, Transaction } from "@ai-finances/schema";
import { appCategories } from "@/lib/categories";
import { getFinanceDbSummary, readFinanceDbSnapshot, replaceTellerLedgerInDb } from "@/lib/db/finance-db";
import type { AccountBalanceSnapshot } from "@/lib/finance-data";
import { runServerEffect } from "@/lib/effect/runtime";
import { TellerSyncError, syncErrorMessage } from "@/lib/effect/sync-errors";
import {
  normalizeProviderCurrencyCode,
  normalizeTellerAmountForAccountType,
  tellerInternalAmountSignConvention
} from "@/lib/teller-normalization";
import {
  isLikelyGroceryTransaction,
  isLikelyIncomeTransaction,
  isLikelyTransferLikeTransaction
} from "@/lib/transaction-classification";
import { findWorkspaceRoot, readWorkspaceEnv, upsertWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";
import { Effect, Either, Schedule } from "effect";

export type TellerEnvironment = "sandbox" | "development" | "production";

export interface TellerConnectionSummary {
  createdAt?: string;
  enrollmentIdSuffix: string;
  environment?: string;
  institutionName?: string;
  lastUpdatedAt?: string;
}

export interface TellerSetupStatus {
  applicationConfigured: boolean;
  certificateConfigured: boolean;
  privateKeyConfigured: boolean;
  accessTokenConfigured: boolean;
  /* Non-secret per-connection metadata for the Settings connections list. */
  connections: TellerConnectionSummary[];
  enrollmentCount: number;
  tokenSigningKeyConfigured: boolean;
  environment: TellerEnvironment;
  latestInstitutionName?: string;
  lastLedgerSyncedAt?: string;
  products: string[];
  readyForConnect: boolean;
  readyForApi: boolean;
  storedAccountCount: number;
  storedTransactionCount: number;
}

export interface TellerConnectConfig {
  applicationId: string;
  environment: TellerEnvironment;
  products: string[];
  selectAccount: "multiple";
  nonce: string;
}

export interface TellerEnrollmentPayload {
  accessToken?: unknown;
  user?: {
    id?: unknown;
  };
  enrollment?: {
    id?: unknown;
    institution?: {
      name?: unknown;
    };
  };
  environment?: unknown;
  nonce?: unknown;
  signatures?: unknown;
}

export interface StoredTellerEnrollment {
  accessToken: string;
  enrollmentId: string;
  userId: string;
  institutionName?: string;
  environment: TellerEnvironment;
  createdAt: string;
  lastUpdatedAt: string;
}

interface TellerAccount {
  id: string;
  enrollment_id: string;
  currency: string;
  institution?: {
    id?: string;
    name?: string;
  };
  last_four?: string;
  links?: {
    balances?: string;
    transactions?: string;
  };
  name: string;
  status: "open" | "closed";
  subtype?: string;
  type: "depository" | "credit";
}

interface TellerBalances {
  account_id: string;
  available: string | null;
  ledger: string | null;
}

interface TellerTransaction {
  account_id: string;
  amount: string;
  date: string;
  description: string;
  details?: {
    category?: string | null;
    counterparty?: {
      name?: string | null;
    };
    processing_status?: string;
  };
  id: string;
  status: "posted" | "pending";
  type?: string;
}

export class TellerSetupError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const tellerProducts = ["transactions", "balance"];
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
const tellerReadRetryPolicy = Schedule.exponential("50 millis").pipe(Schedule.compose(Schedule.recurs(2)));

interface TellerMtlsCredentials {
  cert: Buffer;
  key: Buffer;
}

export async function getTellerSetupStatus(): Promise<TellerSetupStatus> {
  const env = readWorkspaceEnv();
  const applicationConfigured = hasValue(env.TELLER_APPLICATION_ID);
  const certificateConfigured = isConfiguredTellerSecret(env.TELLER_CERTIFICATE_B64, env.TELLER_CERTIFICATE_PATH);
  const privateKeyConfigured = isConfiguredTellerSecret(env.TELLER_PRIVATE_KEY_B64, env.TELLER_PRIVATE_KEY_PATH);
  const enrollments = getStoredTellerEnrollments(env);
  const accessTokenConfigured =
    enrollments.length > 0 || hasValue(env.TELLER_ACCESS_TOKEN) || hasValue(env.TELLER_ENROLLMENT_ACCESS_TOKEN);
  const latestEnrollment = enrollments.at(-1);
  const ledgerSummary = await getFinanceDbSummary();

  return {
    applicationConfigured,
    certificateConfigured,
    privateKeyConfigured,
    accessTokenConfigured,
    connections: enrollments.map((enrollment) => ({
      createdAt: enrollment.createdAt,
      // Last 6 chars only — enough to disambiguate, never the full id or token.
      enrollmentIdSuffix: enrollment.enrollmentId.slice(-6),
      environment: enrollment.environment,
      institutionName: enrollment.institutionName,
      lastUpdatedAt: enrollment.lastUpdatedAt
    })),
    enrollmentCount: enrollments.length,
    tokenSigningKeyConfigured: hasValue(env.TELLER_TOKEN_SIGNING_PUBLIC_KEY),
    environment: normalizeTellerEnvironment(env.TELLER_ENVIRONMENT),
    latestInstitutionName: latestEnrollment?.institutionName,
    lastLedgerSyncedAt: ledgerSummary.lastSyncedAt,
    products: tellerProducts,
    readyForConnect: applicationConfigured,
    readyForApi: applicationConfigured && certificateConfigured && privateKeyConfigured && accessTokenConfigured,
    storedAccountCount: ledgerSummary.storedAccountCount,
    storedTransactionCount: ledgerSummary.storedTransactionCount
  };
}

export function createTellerConnectConfig(): TellerConnectConfig {
  const env = readWorkspaceEnv();
  const applicationId = env.TELLER_APPLICATION_ID;

  if (!hasValue(applicationId)) {
    throw new TellerSetupError("TELLER_APPLICATION_ID is missing in the ignored local .env file.");
  }

  return {
    applicationId,
    environment: normalizeTellerEnvironment(env.TELLER_ENVIRONMENT),
    products: tellerProducts,
    selectAccount: "multiple",
    nonce: randomBytes(24).toString("base64url")
  };
}

export async function saveTellerEnrollment(payload: TellerEnrollmentPayload, expectedNonce?: string) {
  const env = readWorkspaceEnv();
  const accessToken = requireString(payload.accessToken, "Missing Teller access token from enrollment.");
  const userId = requireString(payload.user?.id, "Missing Teller user id from enrollment.");
  const enrollmentId = requireString(payload.enrollment?.id, "Missing Teller enrollment id from enrollment.");
  const institutionName = asOptionalString(payload.enrollment?.institution?.name);
  const environment = normalizeTellerEnvironment(asOptionalString(payload.environment) ?? env.TELLER_ENVIRONMENT);
  const nonce = requireString(payload.nonce, "Missing Teller nonce from enrollment.");

  if (expectedNonce && nonce !== expectedNonce) {
    throw new TellerSetupError("Teller enrollment nonce did not match the current setup session.");
  }

  const verification = verifyEnrollmentSignature({
    accessToken,
    userId,
    enrollmentId,
    environment,
    nonce,
    signatures: payload.signatures,
    env
  });

  if (verification === "failed") {
    throw new TellerSetupError("Teller enrollment signature could not be verified.");
  }

  const savedAt = new Date().toISOString();
  const existingEnrollments = getStoredTellerEnrollments(env);
  const enrollment: StoredTellerEnrollment = {
    accessToken,
    enrollmentId,
    userId,
    institutionName,
    environment,
    createdAt: existingEnrollments.find((candidate) => candidate.enrollmentId === enrollmentId)?.createdAt ?? savedAt,
    lastUpdatedAt: savedAt
  };
  const enrollments = [
    ...existingEnrollments.filter((candidate) => candidate.enrollmentId !== enrollmentId),
    enrollment
  ];

  await upsertWorkspaceEnv({
    TELLER_ACCESS_TOKEN: accessToken,
    TELLER_ENROLLMENT_ID: enrollmentId,
    TELLER_USER_ID: userId,
    TELLER_LAST_ENROLLED_AT: savedAt,
    TELLER_ENROLLMENTS_B64: encodeTellerEnrollments(enrollments)
  });

  return {
    saved: true,
    verification,
    status: await getTellerSetupStatus()
  };
}

export async function testTellerAccounts() {
  const env = readWorkspaceEnv();
  const accessToken = getLatestTellerAccessToken(env);
  const credentials = getTellerMtlsCredentials(env);

  if (!hasValue(accessToken)) {
    throw new TellerSetupError("TELLER_ACCESS_TOKEN is missing. Run Teller Connect first.");
  }

  if (!credentials) {
    throw new TellerSetupError("Teller certificate/private-key paths are missing or unreadable.");
  }

  const accounts = await tellerRequestJson<unknown[]>({
    pathName: "/accounts",
    accessToken,
    cert: credentials.cert,
    key: credentials.key,
    apiVersion: env.TELLER_API_VERSION || "2020-10-12"
  });

  return {
    ok: true,
    accountCount: Array.isArray(accounts) ? accounts.length : 0
  };
}

export interface TellerSyncResult {
  accountCount: number;
  enrollmentCount: number;
  errors: string[];
  lastSyncedAt: string;
  ok: boolean;
  status: TellerSetupStatus;
  transactionCount: number;
}

export function syncTellerData(): Promise<TellerSyncResult> {
  return runServerEffect(syncTellerDataEffect());
}

export function syncTellerDataEffect(): Effect.Effect<TellerSyncResult, TellerSyncError, never> {
  return Effect.gen(function* () {
    const env = readWorkspaceEnv();
    const enrollments = getStoredTellerEnrollments(env);
    const credentials = getTellerMtlsCredentials(env);

    if (enrollments.length === 0) {
      return yield* Effect.fail(
        new TellerSyncError({ message: "No Teller enrollments are saved. Add a Teller connection first." })
      );
    }

    if (!credentials) {
      return yield* Effect.fail(
        new TellerSyncError({ message: "Teller certificate/private-key paths are missing or unreadable." })
      );
    }

    const { cert, key } = credentials;
    const apiVersion = env.TELLER_API_VERSION || "2020-10-12";
    const syncStartDate = env.TELLER_SYNC_START_DATE || getDefaultSyncStartDate();
    const syncedAt = new Date().toISOString();
    const accounts: Account[] = [];
    const transactions: Transaction[] = [];
    const providerConnections: ProviderConnection[] = [];
    const errors: string[] = [];
    const failedEnrollmentIds = new Set<string>();
    const failedEnrollmentErrors = new Map<string, string>();
    let carriedBalanceSnapshots: AccountBalanceSnapshot[] | undefined;

    for (const enrollment of enrollments) {
      const result = yield* syncTellerEnrollmentEffect({
        accounts,
        apiVersion,
        cert,
        enrollment,
        errors,
        key,
        providerConnections,
        syncStartDate,
        syncedAt,
        transactions
      }).pipe(Effect.either);

      if (Either.isLeft(result)) {
        const errorMessage = `${enrollment.institutionName ?? enrollment.enrollmentId}: ${syncErrorMessage(
          result.left,
          "unknown Teller sync error"
        )}`;
        errors.push(errorMessage);
        failedEnrollmentIds.add(enrollment.enrollmentId);
        failedEnrollmentErrors.set(enrollment.enrollmentId, errorMessage);
      }
    }

    if (failedEnrollmentIds.size === enrollments.length) {
      const existingSnapshot = yield* tellerPromise(
        () => readFinanceDbSnapshot(),
        "Failed to read existing Teller ledger."
      );

      return {
        ok: false,
        accountCount: existingSnapshot?.accounts.length ?? 0,
        transactionCount: existingSnapshot?.transactions.length ?? 0,
        enrollmentCount: enrollments.length,
        errors,
        lastSyncedAt: existingSnapshot?.lastSyncedAt ?? syncedAt,
        status: yield* tellerPromise(() => getTellerSetupStatus(), "Failed to read Teller setup status.")
      };
    }

    if (failedEnrollmentIds.size > 0) {
      const existingSnapshot = yield* tellerPromise(
        () => readFinanceDbSnapshot(),
        "Failed to read existing Teller ledger."
      );

      if (existingSnapshot) {
        const failedProviderConnectionIds = new Set(
          Array.from(failedEnrollmentIds).map((enrollmentId) => providerConnectionIdForEnrollment(enrollmentId))
        );
        const errorByProviderConnectionId = new Map(
          Array.from(failedEnrollmentErrors).map(([enrollmentId, errorMessage]) => [
            providerConnectionIdForEnrollment(enrollmentId),
            errorMessage
          ])
        );
        const carriedAccounts = existingSnapshot.accounts.filter((account) =>
          failedProviderConnectionIds.has(account.providerConnectionId)
        );
        const carriedAccountIds = new Set(carriedAccounts.map((account) => account.id));
        const carriedProviderConnections = existingSnapshot.providerConnections
          .filter((connection) => failedProviderConnectionIds.has(connection.id))
          .map((connection) => ({
            ...connection,
            status: "error" as const,
            errorMessage:
              errorByProviderConnectionId.get(connection.id) ?? connection.errorMessage ?? "Teller enrollment sync failed."
          }));

        providerConnections.push(...carriedProviderConnections);
        accounts.push(...carriedAccounts);
        transactions.push(
          ...existingSnapshot.transactions.filter((transaction) =>
            failedProviderConnectionIds.has(transaction.providerConnectionId)
          )
        );
        carriedBalanceSnapshots = existingSnapshot.balanceSnapshots?.filter((snapshot) =>
          carriedAccountIds.has(snapshot.accountId)
        );
      }
    }

    const dedupedAccounts = dedupeById(accounts);
    const dedupedTransactions = dedupeById(transactions).sort((left, right) => right.date.localeCompare(left.date));
    const dedupedProviderConnections = dedupeById(providerConnections);
    const dedupedBalanceSnapshots = carriedBalanceSnapshots ? dedupeById(carriedBalanceSnapshots) : undefined;

    const ledger = {
      source: "teller",
      version: 1,
      lastSyncedAt: syncedAt,
      syncStartDate,
      enrollmentCount: enrollments.length,
      accounts: dedupedAccounts,
      balanceSnapshots: dedupedBalanceSnapshots,
      transactions: dedupedTransactions,
      providerConnections: dedupedProviderConnections,
      normalization: {
        amountSignConvention: tellerInternalAmountSignConvention
      },
      syncSummary: {
        accountCount: dedupedAccounts.length,
        transactionCount: dedupedTransactions.length,
        errors
      }
    } as const;

    yield* tellerPromise(() => replaceTellerLedgerInDb(ledger), "Failed to replace Teller ledger.");

    return {
      ok: errors.length === 0,
      accountCount: dedupedAccounts.length,
      transactionCount: dedupedTransactions.length,
      enrollmentCount: enrollments.length,
      errors,
      lastSyncedAt: syncedAt,
      status: yield* tellerPromise(() => getTellerSetupStatus(), "Failed to read Teller setup status.")
    };
  });
}

function syncTellerEnrollmentEffect({
  accounts,
  apiVersion,
  cert,
  enrollment,
  errors,
  key,
  providerConnections,
  syncStartDate,
  syncedAt,
  transactions
}: {
  accounts: Account[];
  apiVersion: string;
  cert: Buffer;
  enrollment: StoredTellerEnrollment;
  errors: string[];
  key: Buffer;
  providerConnections: ProviderConnection[];
  syncStartDate: string;
  syncedAt: string;
  transactions: Transaction[];
}): Effect.Effect<void, TellerSyncError, never> {
  return Effect.gen(function* () {
    const providerConnectionId = providerConnectionIdForEnrollment(enrollment.enrollmentId);
    const tellerAccounts = yield* tellerRequestJsonEffect<TellerAccount[]>({
      pathName: "/accounts",
      accessToken: enrollment.accessToken,
      cert,
      key,
      apiVersion
    });

    providerConnections.push({
      id: providerConnectionId,
      provider: "teller",
      displayName: enrollment.institutionName
        ? `Teller - ${enrollment.institutionName}`
        : `Teller - ${enrollment.enrollmentId}`,
      status: "connected",
      configured: true,
      lastSyncedAt: syncedAt
    });

    for (const tellerAccount of tellerAccounts.filter((account) => account.status === "open")) {
      const accountType = mapTellerAccountType(tellerAccount);
      const currency = normalizeProviderCurrencyCode(tellerAccount.currency);
      const balance = yield* fetchTellerBalanceEffect({
        account: tellerAccount,
        accessToken: enrollment.accessToken,
        cert,
        key,
        apiVersion,
        errors
      });
      accounts.push(mapTellerAccount({ tellerAccount, balance, providerConnectionId, syncedAt }));

      if (tellerAccount.links?.transactions) {
        const accountTransactions = yield* fetchTellerTransactionsEffect({
          accountId: tellerAccount.id,
          accessToken: enrollment.accessToken,
          apiVersion,
          cert,
          errors,
          key,
          startDate: syncStartDate
        });
        transactions.push(
          ...accountTransactions.map((transaction) =>
            mapTellerTransaction({ accountType, currency, transaction, providerConnectionId })
          )
        );
      }
    }
  });
}

export function getStoredTellerEnrollments(env: WorkspaceEnv = readWorkspaceEnv()): StoredTellerEnrollment[] {
  const storedEnrollments = parseStoredTellerEnrollments(env.TELLER_ENROLLMENTS_B64);
  const legacyEnrollment = createLegacyEnrollment(env);
  // The legacy single-token vars mirror the LATEST enrollment, but without
  // institution metadata — they only fill in when the id is missing from the
  // bundle, never replace a richer bundle entry.
  const enrollments =
    legacyEnrollment && !storedEnrollments.some((enrollment) => enrollment.enrollmentId === legacyEnrollment.enrollmentId)
      ? [...storedEnrollments, legacyEnrollment]
      : storedEnrollments;

  return enrollments.filter((enrollment, index, allEnrollments) => {
    const firstIndex = allEnrollments.findIndex((candidate) => candidate.enrollmentId === enrollment.enrollmentId);
    return firstIndex === index;
  });
}

function verifyEnrollmentSignature({
  accessToken,
  userId,
  enrollmentId,
  environment,
  nonce,
  signatures,
  env
}: {
  accessToken: string;
  userId: string;
  enrollmentId: string;
  environment: TellerEnvironment;
  nonce: string;
  signatures: unknown;
  env: WorkspaceEnv;
}): "verified" | "skipped" | "failed" {
  if (!hasValue(env.TELLER_TOKEN_SIGNING_PUBLIC_KEY)) {
    return "skipped";
  }

  if (!Array.isArray(signatures) || signatures.length === 0) {
    return "failed";
  }

  const publicKey = createPublicKey({
    key: Buffer.concat([ed25519SpkiPrefix, decodeBase64ish(env.TELLER_TOKEN_SIGNING_PUBLIC_KEY)]),
    format: "der",
    type: "spki"
  });
  const message = `${nonce}.${accessToken}.${userId}.${enrollmentId}.${environment}`;
  const digest = createHash("sha256").update(message).digest();

  for (const signature of signatures) {
    if (typeof signature !== "string") {
      continue;
    }

    const decodedSignature = decodeBase64ish(signature);

    if (
      verify(null, digest, publicKey, decodedSignature) ||
      verify(null, Buffer.from(message), publicKey, decodedSignature)
    ) {
      return "verified";
    }
  }

  return "failed";
}

function tellerRequestJson<T>({
  pathName,
  accessToken,
  cert,
  key,
  apiVersion
}: {
  pathName: string;
  accessToken: string;
  cert: Buffer;
  key: Buffer;
  apiVersion: string;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.teller.io",
        path: pathName,
        method: "GET",
        cert,
        key,
        headers: {
          Authorization: `Basic ${Buffer.from(`${accessToken}:`).toString("base64")}`,
          "Teller-Version": apiVersion
        }
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new TellerSetupError(`Teller API returned HTTP ${res.statusCode ?? "unknown"}.`, res.statusCode ?? 502));
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new TellerSetupError("Teller API returned invalid JSON.", 502));
          }
        });
      }
    );

    req.setTimeout(60_000, () => {
      req.destroy(new TellerSetupError("Teller API request timed out.", 504));
    });
    req.on("error", reject);
    req.end();
  });
}

function tellerPromise<T>(task: () => Promise<T>, fallback: string): Effect.Effect<T, TellerSyncError, never> {
  return Effect.tryPromise({
    try: task,
    catch: (error) => new TellerSyncError({ cause: error, message: syncErrorMessage(error, fallback) })
  });
}

function tellerRequestJsonEffect<T>({
  pathName,
  accessToken,
  cert,
  key,
  apiVersion
}: {
  pathName: string;
  accessToken: string;
  cert: Buffer;
  key: Buffer;
  apiVersion: string;
}): Effect.Effect<T, TellerSyncError, never> {
  return tellerPromise(
    () =>
      tellerRequestJson<T>({
        pathName,
        accessToken,
        cert,
        key,
        apiVersion
      }),
    "Teller API request failed."
  ).pipe(
    Effect.timeoutFail({
      duration: "65 seconds",
      onTimeout: () => new TellerSyncError({ message: "Teller API request timed out." })
    }),
    Effect.retry(tellerReadRetryPolicy)
  );
}

function fetchTellerBalanceEffect({
  account,
  accessToken,
  apiVersion,
  cert,
  errors,
  key
}: {
  account: TellerAccount;
  accessToken: string;
  apiVersion: string;
  cert: Buffer;
  errors: string[];
  key: Buffer;
}): Effect.Effect<TellerBalances | null, never, never> {
  if (!account.links?.balances) {
    return Effect.succeed(null);
  }

  return tellerRequestJsonEffect<TellerBalances>({
    pathName: `/accounts/${encodeURIComponent(account.id)}/balances`,
    accessToken,
    cert,
    key,
    apiVersion
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        errors.push(`${account.name}: balance sync failed (${syncErrorMessage(error, "unknown error")})`);
        return null;
      })
    )
  );
}

function fetchTellerTransactionsEffect({
  accountId,
  accessToken,
  apiVersion,
  cert,
  errors,
  key,
  startDate
}: {
  accountId: string;
  accessToken: string;
  apiVersion: string;
  cert: Buffer;
  errors: string[];
  key: Buffer;
  startDate: string;
}): Effect.Effect<TellerTransaction[], never, never> {
  return tellerRequestJsonEffect<TellerTransaction[]>({
    pathName: `/accounts/${encodeURIComponent(accountId)}/transactions?start_date=${encodeURIComponent(startDate)}`,
    accessToken,
    cert,
    key,
    apiVersion
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        errors.push(`${accountId}: transaction sync failed (${syncErrorMessage(error, "unknown error")})`);
        return [];
      })
    )
  );
}

function mapTellerAccount({
  tellerAccount,
  balance,
  providerConnectionId,
  syncedAt
}: {
  tellerAccount: TellerAccount;
  balance: TellerBalances | null;
  providerConnectionId: string;
  syncedAt: string;
}): Account {
  const accountType = mapTellerAccountType(tellerAccount);
  const currentBalance = parseMoney(balance?.ledger ?? balance?.available ?? "0");

  return {
    id: accountIdForTeller(tellerAccount.id),
    providerConnectionId,
    groupId: groupIdForAccountType(accountType),
    name: tellerAccount.name,
    institutionName: tellerAccount.institution?.name ?? "Teller institution",
    type: accountType,
    mask: tellerAccount.last_four,
    currency: normalizeProviderCurrencyCode(tellerAccount.currency),
    currentBalance,
    availableBalance: balance?.available === null || balance?.available === undefined ? undefined : parseMoney(balance.available),
    includedInNetWorth: true,
    lastUpdatedAt: syncedAt
  };
}

function mapTellerTransaction({
  accountType,
  currency,
  transaction,
  providerConnectionId
}: {
  accountType: AccountType;
  currency: string;
  transaction: TellerTransaction;
  providerConnectionId: string;
}): Transaction {
  const counterparty = transaction.details?.counterparty?.name?.trim();
  const merchantName = counterparty && counterparty.length > 0 ? counterparty : cleanDescription(transaction.description);
  const amount = normalizeTellerAmountForAccountType(parseMoney(transaction.amount), accountType);
  const categoryId = mapTellerTransactionCategory({
    description: transaction.description,
    merchantName,
    providerCategory: transaction.details?.category,
    transactionType: transaction.type
  });

  return {
    id: transactionIdForTeller(transaction.id),
    accountId: accountIdForTeller(transaction.account_id),
    providerConnectionId,
    date: transaction.date,
    authorizedDate: transaction.status === "pending" ? transaction.date : undefined,
    postedDate: transaction.status === "posted" ? transaction.date : undefined,
    merchantName,
    description: transaction.description,
    amount,
    currency,
    categoryId,
    status: transaction.status,
    reviewed: false,
    tags: [transaction.type ? `teller:${transaction.type}` : "teller"]
  };
}

function mapTellerTransactionCategory({
  description,
  merchantName,
  providerCategory,
  transactionType
}: {
  description: string;
  merchantName: string;
  providerCategory: string | null | undefined;
  transactionType: string | null | undefined;
}) {
  if (
    isLikelyTransferLikeTransaction({
      description,
      merchantName,
      providerCategory,
      transactionType
    })
  ) {
    return "cat_transfer";
  }

  if (
    isLikelyIncomeTransaction({
      description,
      merchantName,
      providerCategory
    })
  ) {
    return "cat_income";
  }

  if (
    isLikelyGroceryTransaction({
      description,
      merchantName,
      providerCategory
    })
  ) {
    return "cat_food";
  }

  return mapTellerCategory(providerCategory);
}

function mapTellerAccountType(account: TellerAccount): AccountType {
  if (account.subtype === "credit_card") {
    return "credit_card";
  }

  if (account.subtype === "checking") {
    return "checking";
  }

  if (account.subtype === "savings" || account.subtype === "money_market" || account.subtype === "certificate_of_deposit") {
    return "savings";
  }

  return account.type === "credit" ? "credit_card" : "cash";
}

function mapTellerCategory(category: string | null | undefined) {
  switch (category) {
    case "income":
      return "cat_income";
    case "accommodation":
    case "home":
      return "cat_housing";
    case "bar":
    case "dining":
    case "groceries":
      return "cat_food";
    case "fuel":
    case "transport":
    case "transportation":
      return "cat_transportation";
    case "advertising":
    case "office":
    case "phone":
    case "software":
      return "cat_software";
    case "clothing":
    case "electronics":
    case "shopping":
      return "cat_shopping";
    case "entertainment":
    case "sport":
      return "cat_travel";
    case "investment":
    case "loan":
      return "cat_transfer";
    default:
      return appCategories.some((candidate) => candidate.id === "cat_other") ? "cat_other" : "cat_transfer";
  }
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

function providerConnectionIdForEnrollment(enrollmentId: string) {
  return `provider_teller_${enrollmentId}`;
}

function accountIdForTeller(accountId: string) {
  return `teller_${accountId}`;
}

function transactionIdForTeller(transactionId: string) {
  return `teller_${transactionId}`;
}

function parseMoney(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function cleanDescription(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getDefaultSyncStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 370);
  return date.toISOString().slice(0, 10);
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function getLatestTellerAccessToken(env: WorkspaceEnv): string | undefined {
  const latestEnrollment = getStoredTellerEnrollments(env).at(-1);
  return latestEnrollment?.accessToken || env.TELLER_ACCESS_TOKEN || env.TELLER_ENROLLMENT_ACCESS_TOKEN;
}

function parseStoredTellerEnrollments(value: string | undefined): StoredTellerEnrollment[] {
  if (!hasValue(value)) {
    return [];
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((candidate) => {
      if (!isStoredTellerEnrollment(candidate)) {
        return [];
      }

      return [candidate];
    });
  } catch {
    return [];
  }
}

function createLegacyEnrollment(env: WorkspaceEnv): StoredTellerEnrollment | null {
  const accessToken = env.TELLER_ACCESS_TOKEN || env.TELLER_ENROLLMENT_ACCESS_TOKEN;
  const enrollmentId = env.TELLER_ENROLLMENT_ID;
  const userId = env.TELLER_USER_ID;

  if (!hasValue(accessToken) || !hasValue(enrollmentId) || !hasValue(userId)) {
    return null;
  }

  const lastUpdatedAt = env.TELLER_LAST_ENROLLED_AT || new Date(0).toISOString();

  return {
    accessToken,
    enrollmentId,
    userId,
    environment: normalizeTellerEnvironment(env.TELLER_ENVIRONMENT),
    createdAt: lastUpdatedAt,
    lastUpdatedAt
  };
}

function encodeTellerEnrollments(enrollments: StoredTellerEnrollment[]): string {
  return Buffer.from(JSON.stringify(enrollments)).toString("base64url");
}

function isStoredTellerEnrollment(value: unknown): value is StoredTellerEnrollment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredTellerEnrollment>;

  return (
    hasValue(candidate.accessToken) &&
    hasValue(candidate.enrollmentId) &&
    hasValue(candidate.userId) &&
    hasValue(candidate.createdAt) &&
    hasValue(candidate.lastUpdatedAt) &&
    (candidate.environment === "sandbox" || candidate.environment === "development" || candidate.environment === "production") &&
    (!candidate.institutionName || typeof candidate.institutionName === "string")
  );
}

function normalizeTellerEnvironment(value: string | undefined): TellerEnvironment {
  if (value === "development" || value === "production" || value === "sandbox") {
    return value;
  }

  return "development";
}

function resolveConfiguredPath(value: string | undefined): string | null {
  if (!hasValue(value)) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.join(findWorkspaceRoot(), value);
}

function isConfiguredTellerSecret(base64Value: string | undefined, pathValue: string | undefined): boolean {
  if (hasValue(base64Value)) {
    return true;
  }

  const configuredPath = resolveConfiguredPath(pathValue);
  return Boolean(configuredPath && existsSync(configuredPath));
}

function getTellerMtlsCredentials(env: WorkspaceEnv): TellerMtlsCredentials | null {
  const cert = readConfiguredTellerSecret(env.TELLER_CERTIFICATE_B64, env.TELLER_CERTIFICATE_PATH);
  const key = readConfiguredTellerSecret(env.TELLER_PRIVATE_KEY_B64, env.TELLER_PRIVATE_KEY_PATH);

  if (!cert || !key) {
    return null;
  }

  return { cert, key };
}

function readConfiguredTellerSecret(base64Value: string | undefined, pathValue: string | undefined): Buffer | null {
  if (hasValue(base64Value)) {
    return decodeBase64ish(base64Value);
  }

  const configuredPath = resolveConfiguredPath(pathValue);

  if (!configuredPath || !existsSync(configuredPath)) {
    return null;
  }

  return readFileSync(configuredPath);
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TellerSetupError(message);
  }

  return value.trim();
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function decodeBase64ish(value: string): Buffer {
  if (/^[a-f0-9]{128}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}
