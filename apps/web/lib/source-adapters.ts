import type { ExternalSourceKind, ExternalSourceStatus, SourceItemLine } from "@ai-finances/schema";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { constants as zlibConstants, createInflateRaw } from "node:zlib";
import {
  ensureExternalSourceCatalog,
  getExternalSourceStates,
  getSourceStoreSourceSummaries,
  getSourceStoreSummary,
  recordSourceSyncRun,
  type SourceStoreSourceSummary,
  type SourceItemInput,
  type SourceStoreSummary,
  type SourceSyncRunRecord
} from "@/lib/db/finance-db";
import { inferCurrencyCodeFromText, normalizeCurrencyCode } from "@/lib/currency";
import { runServerEffect } from "@/lib/effect/runtime";
import { SourceRefreshError, syncErrorMessage } from "@/lib/effect/sync-errors";
import { maxSourceImportBytes } from "@/lib/source-import-limits";
import {
  fetchMicrosoftSourceRecords,
  microsoftSourceOAuthStatus
} from "@/lib/microsoft-source-oauth";
import { fetchShopSourceItems, normalizeShopOrders, shopSessionStatus } from "@/lib/shop-source";
import { listMailAccountsSync, outlookConfigPath, readIcloudCredentials, type MailAccount } from "@/lib/mail-accounts";
import { fetchIcloudSourceItems } from "@/lib/icloud-source";
import { Effect, Schedule } from "effect";

const execFileAsync = promisify(execFile);
const maxSourceItemsPerSync = 250;
const gmailAuthCommand = "gog login <email> --readonly --services=gmail,calendar --gmail-no-send";
const outlookAuthCommand = "outlook-email-pp-cli auth login --device-code";
const sourceRefreshRetryPolicy = Schedule.max([Schedule.exponential("50 millis"), Schedule.recurs(2)]);

export interface SourceAdapterDefinition {
  mailAccount?: MailAccount;
  authCheckArgs?: string[];
  authCommand?: string;
  binary: string;
  displayName: string;
  evidenceKinds: string[];
  id: string;
  installCommand: string;
  kind: ExternalSourceKind;
  role: string;
  setupSteps: string[];
  syncCommand: string;
}

export interface SourceSetupChecklist {
  commands: SourceSetupCommand[];
  missing: string[];
  nextAction: string;
  ready: boolean;
}

export interface SourceSetupCommand {
  command: string;
  kind: "auth" | "backfill" | "install" | "manual" | "sync";
  label: string;
}

export interface SourceAdapterDiagnostic extends SourceAdapterDefinition {
  cache?: SourceAdapterCacheDiagnostic;
  errorMessage?: string;
  installed: boolean;
  lastSyncedAt?: string;
  refreshMessage?: string;
  setup: SourceSetupChecklist;
  status: ExternalSourceStatus;
  storage: SourceStoreSourceSummary;
  webAuth?: {
    accountEmail?: string;
    accountName?: string;
    configured: boolean;
    connected: boolean;
    startPath: string;
    statusPath: string;
  };
}

export interface SourceAdapterDiagnostics {
  adapters: SourceAdapterDiagnostic[];
  summary: SourceStoreSummary;
}

export interface SourceReadinessSummary {
  blockedCount: number;
  installedCount: number;
  ready: boolean;
  readyCount: number;
  sourceItemCount: number;
  totalCount: number;
}

export interface SourceSyncResult extends SourceSyncRunRecord {
  adapter: SourceAdapterDiagnostic;
  object: "source_sync_run";
}

export interface SourceSyncBatchResult {
  data: SourceSyncResult[];
  object: "source_sync_run_list";
  summary: {
    evidenceLinksSuggested: number;
    itemsWritten: number;
    sourcesAttempted: number;
    sourcesErrored: number;
    sourcesPartial: number;
    sourcesStale: number;
  };
}

export interface SourceImportInput {
  content: string;
  contentEncoding?: "base64" | "text";
  filename?: string;
}

export interface SourceImportPreviewResult {
  data: Array<{
    amount?: number;
    currency?: string;
    external_id: string;
    kind: string;
    merchant_name?: string;
    occurred_at?: string;
    summary: string;
    title: string;
  }>;
  display_name: string;
  error_message?: string;
  filename?: string;
  item_count: number;
  object: "source_import_preview";
  source_id: string;
  status: ExternalSourceStatus;
}

interface AdapterFetchResult {
  errorMessage?: string;
  items: SourceItemInput[];
  refreshFailed?: boolean;
  sourceStatus: ExternalSourceStatus;
}

export interface SourceAdapterCacheDiagnostic {
  path?: string;
  recordCount: number;
  status: "empty" | "has_records" | "missing" | "unreadable" | "unknown";
  summary: string;
}

interface CacheProbeDefinition {
  dbPath: string;
  queries: Array<{
    label: string;
    sql: string;
    usable?: boolean;
  }>;
}

class SourceAdapterError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const sourceAdapterDefinitions = [
  {
    id: "source_gmail",
    kind: "gmail",
    displayName: "Gmail receipts",
    role: "Receipt, order, invoice, travel, and merchant context from Google mailboxes.",
    binary: "gog",
    authCheckArgs: ["status", "--json", "--no-input"],
    installCommand: "brew install gogcli/tap/gog",
    authCommand: gmailAuthCommand,
    setupSteps: [
      gmailAuthCommand,
      "gog gmail search 'newer_than:365d (receipt OR order OR invoice)' --json --results-only --gmail-no-send"
    ],
    syncCommand: "gog gmail search 'newer_than:365d (receipt OR order OR invoice)' --json --results-only --gmail-no-send --select=id,threadId,snippet,payload.headers,internalDate",
    evidenceKinds: ["email", "receipt", "calendar_event"]
  },
  {
    id: "source_amazon_orders",
    kind: "amazon_orders",
    displayName: "Amazon orders",
    role: "Amazon order, item, seller, shipment, payment, and receipt context for Amazon charges.",
    binary: "amazon-orders-pp-cli",
    authCheckArgs: ["auth", "status"],
    installCommand: "npx -y @mvanhorn/printing-press-library install amazon-orders --cli-only",
    authCommand: "amazon-orders-pp-cli auth login --chrome",
    setupSteps: ["amazon-orders-pp-cli auth login --chrome", "amazon-orders-pp-cli sync --since 365d --agent"],
    syncCommand: "amazon-orders-pp-cli orders list --time-filter months-6 --json --no-input",
    evidenceKinds: ["order", "receipt"]
  },
  {
    id: "source_instacart",
    kind: "instacart",
    displayName: "Instacart groceries",
    role: "Grocery orders, purchased item names, retailer context, and recurring household staples.",
    binary: "instacart-pp-cli",
    authCheckArgs: ["auth", "status"],
    installCommand: "npx -y @mvanhorn/printing-press-library install instacart --cli-only",
    authCommand: "instacart-pp-cli auth login",
    setupSteps: [
      "instacart-pp-cli auth login",
      "instacart-pp-cli doctor --json",
      "Backfill through Codex with /pp-instacart backfill my orders, or import JSONL/CSV with instacart-pp-cli history import <path> or an Instacart report export"
    ],
    syncCommand: "instacart-pp-cli history list --limit 250 --json",
    evidenceKinds: ["grocery_order", "order", "receipt"]
  },
  {
    id: "source_airbnb",
    kind: "airbnb",
    displayName: "Airbnb travel context",
    role: "Read-only listing, wishlist, watchlist, host, and price context for lodging charges.",
    binary: "airbnb-pp-cli",
    authCheckArgs: ["auth", "status"],
    installCommand: "npx -y @mvanhorn/printing-press-library install airbnb --cli-only",
    authCommand: "airbnb-pp-cli auth login --chrome",
    setupSteps: [
      "airbnb-pp-cli auth login --chrome",
      "airbnb-pp-cli wishlist sync --agent",
      "airbnb-pp-cli wishlist diff --since <last-year> --agent"
    ],
    syncCommand: "airbnb-pp-cli wishlist sync --agent",
    evidenceKinds: ["travel_listing", "travel_booking"]
  },
  {
    id: "source_outlook_email",
    kind: "outlook_email",
    displayName: "Outlook email",
    role: "Receipt, booking, invoice, and merchant context from Microsoft 365 mail.",
    binary: "outlook-email-pp-cli",
    authCheckArgs: ["auth", "status"],
    installCommand: "npx -y @mvanhorn/printing-press-library install outlook-email --cli-only",
    authCommand: outlookAuthCommand,
    setupSteps: [
      outlookAuthCommand,
      "outlook-email-pp-cli auth set-token <token>",
      "outlook-email-pp-cli sync --resources messages --since 365d --agent"
    ],
    syncCommand: "outlook-email-pp-cli messages list --data-source local --top 250 --agent",
    evidenceKinds: ["email", "receipt", "calendar_event"]
  },
  {
    id: "source_shop_orders",
    kind: "shop_orders",
    displayName: "Shop orders",
    role: "Order, merchant, item, total, and receipt context from Shop order history.",
    binary: "built-in",
    installCommand: "Built into Koban",
    authCommand: "koban sources login shop",
    setupSteps: ["koban sources login shop", "koban sources sync shop"],
    syncCommand: "koban sources sync shop",
    evidenceKinds: ["order", "receipt"]
  },
  {
    id: "source_icloud_mail", kind: "icloud_mail", displayName: "iCloud Mail",
    binary: "built-in", installCommand: "Built into Koban",
    authCommand: "koban connectors add icloud --profile personal --email you@icloud.com --password-file PATH",
    setupSteps: ["Generate an app-specific password in your Apple Account, then add an iCloud profile."],
    syncCommand: "koban sources sync icloud --profile personal",
    role: "Read-only email receipt and purchase context from iCloud Mail.",
    evidenceKinds: ["email", "receipt"]
  }
] satisfies SourceAdapterDefinition[];

export function allSourceAdapterDefinitions(): SourceAdapterDefinition[] {
  const accounts = listMailAccountsSync();
  const kindFor = { gmail: "gmail", outlook: "outlook_email", icloud: "icloud_mail" } as const;
  const defaults = sourceAdapterDefinitions.filter((definition) => definition.kind !== "icloud_mail" || !accounts.some((account) => account.provider === "icloud"));
  return [...defaults, ...accounts.map((account) => {
    const template = sourceAdapterDefinitions.find((definition) => definition.kind === kindFor[account.provider])!;
    const authCommand = `koban connectors login ${account.provider} --profile ${account.profile}${account.provider === "icloud" ? " --password-file PATH" : ""}`;
    return {
      ...template, id: account.id, mailAccount: account,
      displayName: `${template.displayName} · ${account.label}`,
      authCheckArgs: account.provider === "gmail" ? ["status", "--account", account.email, "--json", "--no-input"]
        : account.provider === "outlook" ? ["--config", outlookConfigPath(account), "auth", "status"] : undefined,
      authCommand,
      setupSteps: [authCommand],
      syncCommand: `koban sources sync ${account.provider} --profile ${account.profile}`
    } satisfies SourceAdapterDefinition;
  })];
}

export async function getSourceAdapterDiagnostics(): Promise<SourceAdapterDiagnostics> {
  await ensureSourceCatalog();
  const [states, sourceSummaries, microsoftOAuth] = await Promise.all([
    getExternalSourceStates(),
    getSourceStoreSourceSummaries(),
    microsoftSourceOAuthStatus()
  ]);
  const adapters = await Promise.all(
    allSourceAdapterDefinitions().map(async (adapter) => {
      const shopSession = adapter.kind === "shop_orders" ? await shopSessionStatus() : undefined;
      const cliInstalled = (adapter.kind === "shop_orders" || adapter.kind === "icloud_mail") ? true : await commandExists(adapter.binary);
      const webAuth =
        adapter.kind === "outlook_email" && !adapter.mailAccount
          ? {
              accountEmail: microsoftOAuth.accountEmail,
              accountName: microsoftOAuth.accountName,
              configured: microsoftOAuth.configured,
              connected: microsoftOAuth.connected,
              startPath: "/api/auth/microsoft/start",
              statusPath: "/api/auth/microsoft/status"
            }
          : undefined;
      const installed = cliInstalled || webAuth?.connected === true;
      const [authState, cache] = await Promise.all([
        adapter.kind === "icloud_mail"
          ? adapter.mailAccount
            ? readIcloudCredentials(adapter.mailAccount.id).then(() => ({ status: "stale" as const, errorMessage: undefined }), () => ({ status: "not_configured" as const, errorMessage: "iCloud app-specific password is missing." }))
            : Promise.resolve({ status: "not_configured" as const, errorMessage: "Add a named iCloud Mail account." })
          : adapter.kind === "shop_orders"
          ? Promise.resolve(shopSession?.configured
              ? { status: "stale" as const }
              : { errorMessage: "Shop session is not configured.", status: "not_configured" as const })
          : cliInstalled && !webAuth?.connected ? checkAdapterAuthState(adapter) : Promise.resolve(undefined),
        cliInstalled && adapter.kind !== "shop_orders" && adapter.kind !== "icloud_mail" && !adapter.mailAccount ? probeSourceAdapterCache(adapter) : Promise.resolve(undefined)
      ]);
      const state = states.get(adapter.id);

      const storage = sourceSummaries.get(adapter.id) ?? emptySourceStorage(adapter.id);
      const authStatus = webAuth?.connected ? "connected" : authState?.status;
      const status = installed ? mergeAdapterStatus(state?.status, authStatus, storage) : "not_configured";
      const setup = buildSourceSetupChecklist(adapter, installed, status, storage);
      if (adapter.kind === "shop_orders" && shopSession?.configured && storage.sourceItemCount === 0) {
        setup.missing = ["Import Shop order history to verify the saved session."];
        setup.nextAction = "Run koban sources sync shop.";
      }

      return {
        ...adapter,
        cache,
        errorMessage: sourceDiagnosticErrorMessage({
          authErrorMessage: authState?.errorMessage,
          installed,
          setupReady: setup.ready,
          stateErrorMessage: state?.errorMessage,
          status
        }),
        installed,
        lastSyncedAt: state?.lastSyncedAt,
        refreshMessage: sourceDiagnosticRefreshMessage({
          authErrorMessage: authState?.errorMessage,
          installed,
          setupReady: setup.ready,
          stateErrorMessage: state?.errorMessage,
          status
        }),
        setup,
        status,
        storage,
        webAuth
      } satisfies SourceAdapterDiagnostic;
    })
  );

  return {
    adapters,
    summary: await getSourceStoreSummary()
  };
}

export function summarizeSourceReadiness(diagnostics: SourceAdapterDiagnostics): SourceReadinessSummary {
  const totalCount = diagnostics.adapters.length;
  const readyCount = diagnostics.adapters.filter((adapter) => adapter.setup.ready).length;

  return {
    blockedCount: totalCount - readyCount,
    installedCount: diagnostics.adapters.filter((adapter) => adapter.installed).length,
    ready: totalCount > 0 && readyCount === totalCount,
    readyCount,
    sourceItemCount: diagnostics.summary.sourceItemCount,
    totalCount
  };
}

export function sourceDiagnosticErrorMessage({
  authErrorMessage,
  installed,
  setupReady,
  stateErrorMessage,
  status
}: {
  authErrorMessage?: string;
  installed: boolean;
  setupReady: boolean;
  stateErrorMessage?: string;
  status: ExternalSourceStatus;
}): string | undefined {
  if (!installed) {
    return undefined;
  }

  if (status === "connected" && setupReady) {
    return undefined;
  }

  return authErrorMessage ?? stateErrorMessage;
}

export function sourceDiagnosticRefreshMessage({
  authErrorMessage,
  installed,
  setupReady,
  stateErrorMessage,
  status
}: {
  authErrorMessage?: string;
  installed: boolean;
  setupReady: boolean;
  stateErrorMessage?: string;
  status: ExternalSourceStatus;
}): string | undefined {
  if (!installed || !setupReady || status !== "connected") {
    return undefined;
  }

  const message = authErrorMessage ?? stateErrorMessage;

  return message ? `Automatic refresh needs attention: ${message}` : undefined;
}

export function syncSourceAdapter(sourceId: string): Promise<SourceSyncResult> {
  return runServerEffect(syncSourceAdapterEffect(sourceId));
}

function syncSourceAdapterEffect(sourceId: string): Effect.Effect<SourceSyncResult, SourceRefreshError, never> {
  return Effect.gen(function* () {
    yield* sourcePromise(() => ensureSourceCatalog(), "Source catalog initialization failed.");
    const definition = allSourceAdapterDefinitions().find((adapter) => adapter.id === sourceId);

    if (!definition) {
      return yield* Effect.fail(new SourceRefreshError({ message: `Unknown source adapter: ${sourceId}` }));
    }

    const installed = yield* sourcePromise(
      async () =>
        (definition.kind === "shop_orders" || definition.kind === "icloud_mail")
          ? true
          : definition.kind === "outlook_email" && !definition.mailAccount && (await microsoftSourceOAuthStatus()).connected
          ? true
          : commandExists(definition.binary),
      `Source adapter installation check failed for ${definition.displayName}.`
    );
    const startedAt = new Date().toISOString();

    if (!installed) {
      const finishedAt = new Date().toISOString();
      const errorMessage = `Missing CLI binary ${definition.binary}. Install with: ${definition.installCommand}`;
      const run = yield* sourcePromise(
        () =>
          recordSourceSyncRun({
            errorMessage,
            finishedAt,
            items: [],
            runStatus: "error",
            sourceId: definition.id,
            sourceStatus: "not_configured",
            startedAt
          }),
        "Source sync run recording failed."
      );

      return {
        ...run,
        adapter: {
          ...definition,
          errorMessage,
          installed: false,
          lastSyncedAt: finishedAt,
          refreshMessage: undefined,
          setup: buildSourceSetupChecklist(definition, false, "not_configured", emptySourceStorage(definition.id)),
          status: "not_configured",
          storage: emptySourceStorage(definition.id)
        },
        object: "source_sync_run"
      } satisfies SourceSyncResult;
    }

    return yield* syncInstalledSourceAdapterEffect(definition, startedAt);
  });
}

function syncInstalledSourceAdapterEffect(
  definition: SourceAdapterDefinition,
  startedAt: string
): Effect.Effect<SourceSyncResult, SourceRefreshError, never> {
  return Effect.gen(function* () {
    const existingStorage = yield* sourcePromise(
      () => getSourceStorage(definition.id),
      `Source storage lookup failed for ${definition.displayName}.`
    );
    const result = yield* fetchAdapterItemsEffect(definition);
    const retainedMessage = retainedExistingRecordsMessage(definition, result, existingStorage);
    const sourceStatus = retainedMessage ? "connected" : result.sourceStatus;
    const finishedAt = new Date().toISOString();
    const run = yield* sourcePromise(
      () =>
        recordSourceSyncRun({
          errorMessage: retainedMessage ? undefined : result.errorMessage,
          finishedAt,
          items: result.items,
          runStatus: result.refreshFailed ? "partial" : "succeeded",
          sourceId: definition.id,
          sourceStatus,
          startedAt
        }),
      "Source sync run recording failed."
    );
    const storage = yield* sourcePromise(
      () => getSourceStorage(definition.id),
      `Source storage lookup failed for ${definition.displayName}.`
    );
    const errorMessage = retainedMessage ?? result.errorMessage;
    const setup = buildSourceSetupChecklist(definition, true, sourceStatus, storage);

    return {
      ...run,
      errorMessage,
      adapter: {
        ...definition,
        errorMessage: sourceDiagnosticErrorMessage({
          authErrorMessage: result.errorMessage,
          installed: true,
          setupReady: setup.ready,
          stateErrorMessage: retainedMessage,
          status: sourceStatus
        }),
        installed: true,
        lastSyncedAt: finishedAt,
        refreshMessage: sourceDiagnosticRefreshMessage({
          authErrorMessage: result.errorMessage,
          installed: true,
          setupReady: setup.ready,
          stateErrorMessage: retainedMessage,
          status: sourceStatus
        }),
        setup,
        status: sourceStatus,
        storage
      },
      object: "source_sync_run"
    } satisfies SourceSyncResult;
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const finishedAt = new Date().toISOString();
        const errorMessage = syncErrorMessage(error, "Source sync failed.");
        const storage = yield* sourcePromise(
          () => getSourceStorage(definition.id),
          `Source storage lookup failed for ${definition.displayName}.`
        );

        if (storage.sourceItemCount > 0) {
          const retainedMessage = refreshFailedExistingRecordsMessage(definition, storage.sourceItemCount, errorMessage);
          const run = yield* sourcePromise(
            () =>
              recordSourceSyncRun({
                errorMessage: retainedMessage,
                finishedAt,
                items: [],
                runStatus: "partial",
                sourceId: definition.id,
                sourceStatus: "connected",
                startedAt
              }),
            "Source sync run recording failed."
          );

          return {
            ...run,
            errorMessage: retainedMessage,
            adapter: {
              ...definition,
              errorMessage: undefined,
              installed: true,
              lastSyncedAt: finishedAt,
              refreshMessage: retainedMessage,
              setup: buildSourceSetupChecklist(definition, true, "connected", storage),
              status: "connected",
              storage
            },
            object: "source_sync_run"
          } satisfies SourceSyncResult;
        }

        const run = yield* sourcePromise(
          () =>
            recordSourceSyncRun({
              errorMessage,
              finishedAt,
              items: [],
              runStatus: "error",
              sourceId: definition.id,
              sourceStatus: "error",
              startedAt
            }),
          "Source sync run recording failed."
        );

        return {
          ...run,
          adapter: {
            ...definition,
            errorMessage,
            installed: true,
            lastSyncedAt: finishedAt,
            refreshMessage: undefined,
            setup: buildSourceSetupChecklist(definition, true, "error", storage),
            status: "error",
            storage
          },
          object: "source_sync_run"
        } satisfies SourceSyncResult;
      })
    )
  );
}

export function syncSourceAdapters(sourceIds?: string[]): Promise<SourceSyncBatchResult> {
  return runServerEffect(syncSourceAdaptersEffect(sourceIds));
}

export function syncSourceAdaptersEffect(
  sourceIds?: string[]
): Effect.Effect<SourceSyncBatchResult, SourceRefreshError, never> {
  return Effect.gen(function* () {
    const ids = sourceIds?.length ? sourceIds : allSourceAdapterDefinitions().map((adapter) => adapter.id);
    const results = yield* Effect.forEach(ids, (sourceId) => syncSourceAdapterEffect(sourceId), { concurrency: 2 });

    // A sync is the one in-app action that can change whether an adapter is
    // installed or authenticated, so drop the probe caches rather than let the
    // next Settings render report pre-sync state.
    invalidateSourceAdapterProbes();

    return {
      data: results,
      object: "source_sync_run_list",
      summary: summarizeSourceSyncResults(results)
    };
  });
}

export function summarizeSourceSyncResults(
  results: Array<Pick<SourceSyncResult, "evidenceLinksSuggested" | "itemsWritten" | "runStatus" | "sourceStatus">>
): SourceSyncBatchResult["summary"] {
  return {
    evidenceLinksSuggested: results.reduce((sum, result) => sum + result.evidenceLinksSuggested, 0),
    itemsWritten: results.reduce((sum, result) => sum + result.itemsWritten, 0),
    sourcesAttempted: results.length,
    sourcesErrored: results.filter((result) => result.runStatus === "error").length,
    sourcesPartial: results.filter((result) => result.runStatus === "partial").length,
    sourcesStale: results.filter((result) => result.runStatus === "succeeded" && result.sourceStatus === "stale").length
  };
}

function retainedExistingRecordsMessage(
  adapter: SourceAdapterDefinition,
  result: AdapterFetchResult,
  storage: Pick<SourceStoreSourceSummary, "sourceItemCount">
): string | undefined {
  if (!shouldRetainExistingSourceRecords(result, storage)) {
    return undefined;
  }

  return `No new ${adapter.displayName} records returned; using ${storage.sourceItemCount.toLocaleString()} existing imported local records.`;
}

export function shouldRetainExistingSourceRecords(
  result: { items: readonly unknown[]; sourceStatus: ExternalSourceStatus },
  storage: Pick<SourceStoreSourceSummary, "sourceItemCount">
): boolean {
  return result.items.length === 0 && result.sourceStatus === "stale" && storage.sourceItemCount > 0;
}

function refreshFailedExistingRecordsMessage(
  adapter: SourceAdapterDefinition,
  sourceItemCount: number,
  cause: string
): string {
  return `Source refresh failed for ${adapter.displayName}; using ${sourceItemCount.toLocaleString()} existing imported local records. ${cause}`;
}

export async function importSourceAdapterPayload(
  sourceId: string,
  input: SourceImportInput
): Promise<SourceSyncResult> {
  await ensureSourceCatalog();
  const definition = allSourceAdapterDefinitions().find((adapter) => adapter.id === sourceId);

  if (!definition) {
    throw new SourceAdapterError(`Unknown source adapter: ${sourceId}`);
  }

  const startedAt = new Date().toISOString();
  const installed = definition.binary === "built-in" || await commandExists(definition.binary);

  try {
    const items = parseAndNormalizeSourceImport(definition, input);
    const finishedAt = new Date().toISOString();
    const errorMessage =
      items.length === 0
        ? `No ${definition.displayName} records could be normalized from ${input.filename ?? "the uploaded content"}.`
        : undefined;
    const run = await recordSourceSyncRun({
      errorMessage,
      finishedAt,
      items,
      runStatus: "succeeded",
      sourceId: definition.id,
      sourceStatus: items.length > 0 ? "connected" : "stale",
      startedAt
    });
    const storage = await getSourceStorage(definition.id);
    const status = items.length > 0 ? "connected" : "stale";

    return {
      ...run,
      adapter: {
        ...definition,
        errorMessage,
        installed,
        lastSyncedAt: finishedAt,
        refreshMessage: undefined,
        setup: buildSourceSetupChecklist(definition, installed, status, storage),
        status,
        storage
      },
      object: "source_sync_run"
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : "Source import failed.";
    const run = await recordSourceSyncRun({
      errorMessage,
      finishedAt,
      items: [],
      runStatus: "error",
      sourceId: definition.id,
      sourceStatus: "error",
      startedAt
    });
    const storage = await getSourceStorage(definition.id);

    return {
      ...run,
      adapter: {
        ...definition,
        errorMessage,
        installed,
        lastSyncedAt: finishedAt,
        refreshMessage: undefined,
        setup: buildSourceSetupChecklist(definition, installed, "error", storage),
        status: "error",
        storage
      },
      object: "source_sync_run"
    };
  }
}

export function previewSourceAdapterPayload(sourceId: string, input: SourceImportInput): SourceImportPreviewResult {
  const definition = allSourceAdapterDefinitions().find((adapter) => adapter.id === sourceId);

  if (!definition) {
    throw new SourceAdapterError(`Unknown source adapter: ${sourceId}`);
  }

  const items = parseAndNormalizeSourceImport(definition, input);
  const errorMessage =
    items.length === 0
      ? `No ${definition.displayName} records could be normalized from ${input.filename ?? "the uploaded content"}.`
      : undefined;

  return {
    data: items.slice(0, 10).map((item) => ({
      amount: item.amount,
      currency: item.currency,
      external_id: item.externalId,
      kind: item.kind,
      merchant_name: item.merchantName,
      occurred_at: item.occurredAt,
      summary: item.summary,
      title: item.title
    })),
    display_name: definition.displayName,
    error_message: errorMessage,
    filename: input.filename,
    item_count: items.length,
    object: "source_import_preview",
    source_id: definition.id,
    status: items.length > 0 ? "connected" : "stale"
  };
}

function parseAndNormalizeSourceImport(
  definition: SourceAdapterDefinition,
  input: SourceImportInput
): SourceItemInput[] {
  const payload = parseSourceImportContent(input.content, {
    contentEncoding: input.contentEncoding,
    filename: input.filename
  });
  return normalizeAdapterItems(definition, payload);
}

async function getSourceStorage(sourceId: string): Promise<SourceStoreSourceSummary> {
  return (await getSourceStoreSourceSummaries()).get(sourceId) ?? emptySourceStorage(sourceId);
}

function emptySourceStorage(sourceId: string): SourceStoreSourceSummary {
  return {
    evidenceLinkCount: 0,
    sourceId,
    sourceItemCount: 0
  };
}

export function buildSourceSetupChecklist(
  adapter: SourceAdapterDefinition,
  installed: boolean,
  status: ExternalSourceStatus,
  storage: Pick<SourceStoreSourceSummary, "sourceItemCount">
): SourceSetupChecklist {
  const commands = sourceSetupCommands(adapter, installed);
  const missing: string[] = [];

  if (!installed) {
    missing.push(`Install ${adapter.binary}.`);
  }

  if (installed && status !== "connected" && storage.sourceItemCount === 0) {
    missing.push("Authenticate the source account.");
  }

  if (installed && storage.sourceItemCount === 0) {
    missing.push(sourceRecordsMissingMessage(adapter));
  }

  const ready = installed && storage.sourceItemCount > 0;

  return {
    commands,
    missing,
    nextAction: sourceNextAction({ adapter, installed, missing, status, storage }),
    ready
  };
}

function sourceSetupCommands(adapter: SourceAdapterDefinition, installed: boolean): SourceSetupCommand[] {
  const commands: SourceSetupCommand[] = [];

  if (!installed) {
    commands.push({
      command: adapter.installCommand,
      kind: "install",
      label: "Install CLI"
    });
  }

  if (adapter.authCommand) {
    commands.push({
      command: adapter.authCommand,
      kind: "auth",
      label: "Authenticate"
    });
  }

  for (const step of adapter.setupSteps) {
    const normalizedStep = step.trim();

    if (!normalizedStep || commands.some((command) => command.command === normalizedStep)) {
      continue;
    }

    commands.push({
      command: normalizedStep,
      kind: sourceSetupCommandKind(normalizedStep),
      label: sourceSetupCommandLabel(normalizedStep)
    });
  }

  if (!commands.some((command) => command.command === adapter.syncCommand)) {
    commands.push({
      command: adapter.syncCommand,
      kind: "sync",
      label: "Sync records"
    });
  }

  return commands;
}

function sourceSetupCommandKind(command: string): SourceSetupCommand["kind"] {
  if (/install/i.test(command)) {
    return "install";
  }

  if (/\bauth\b|login|set-token/i.test(command)) {
    return "auth";
  }

  if (/backfill|history import/i.test(command)) {
    return "backfill";
  }

  if (/sync|list|search|diff/i.test(command)) {
    return "sync";
  }

  return "manual";
}

function sourceSetupCommandLabel(command: string): string {
  switch (sourceSetupCommandKind(command)) {
    case "auth":
      return "Authenticate";
    case "backfill":
      return "Backfill history";
    case "install":
      return "Install CLI";
    case "sync":
      return "Sync records";
    default:
      return "Manual step";
  }
}

function sourceNextAction({
  adapter,
  installed,
  missing,
  status,
  storage
}: {
  adapter: SourceAdapterDefinition;
  installed: boolean;
  missing: string[];
  status: ExternalSourceStatus;
  storage: Pick<SourceStoreSourceSummary, "sourceItemCount">;
}): string {
  if (!installed) {
    return `Install ${adapter.binary}.`;
  }

  if (status !== "connected" && storage.sourceItemCount === 0) {
    return adapter.authCommand ? `Run ${adapter.authCommand}.` : "Authenticate the source account.";
  }

  if (status !== "connected" && storage.sourceItemCount > 0) {
    return "Ready with imported local source records. Authenticate this source to refresh it automatically.";
  }

  if (storage.sourceItemCount === 0) {
    return sourceRecordsNextAction(adapter);
  }

  return missing.length === 0 ? "Ready with local source records." : missing[0];
}

function sourceRecordsMissingMessage(adapter: SourceAdapterDefinition): string {
  switch (adapter.kind) {
    case "instacart":
      return "Backfill Instacart order history or import a real Instacart JSONL/CSV order dump.";
    case "airbnb":
      return "Sync Airbnb wishlist/listing context or import real Airbnb reservation/trip JSON/JSONL/CSV/ICS/ZIP records.";
    case "outlook_email":
      return "Sync Outlook messages or import real Outlook JSON/JSONL/CSV/EML/MBOX/ICS/ZIP message or calendar records.";
    case "gmail":
      return "Search Gmail receipt/order messages or import real Gmail JSON/JSONL/CSV/EML/MBOX/ICS/ZIP records.";
    case "amazon_orders":
      return "Sync Amazon order history or import real Amazon JSON/JSONL/CSV order records.";
    default:
      return "Backfill or import real source records.";
  }
}

function sourceRecordsNextAction(adapter: SourceAdapterDefinition): string {
  switch (adapter.kind) {
    case "instacart":
      return "Backfill Instacart with /pp-instacart backfill my orders or import JSONL/CSV from instacart-pp-cli history import <path> or an Instacart report export.";
    case "airbnb":
      return "Run airbnb-pp-cli wishlist sync --agent, or import a real Airbnb reservation/trip CSV/ICS/ZIP export in Settings.";
    case "outlook_email":
      return "Use Sync source after connecting Microsoft, or import real Outlook JSON/JSONL/CSV/EML/MBOX/ICS/ZIP output.";
    case "gmail":
      return "Run a gog Gmail receipt search or import real Gmail JSON/JSONL/CSV/EML/MBOX/ICS/ZIP output.";
    case "amazon_orders":
      return "Run amazon-orders-pp-cli sync --since 365d --agent or import real Amazon JSON/JSONL/CSV output.";
    default:
      return "Backfill source history or import real JSON/JSONL/CSV records.";
  }
}

export function normalizeInstacartHistory(payload: unknown, sourceId = "source_instacart"): SourceItemInput[] {
  const records = asArrayPayload(payload).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
  const csvPurchaseOrders = normalizeInstacartCsvPurchaseRows(records, sourceId);

  if (csvPurchaseOrders.length > 0) {
    return csvPurchaseOrders.slice(0, maxSourceItemsPerSync);
  }

  return records
    .slice(0, maxSourceItemsPerSync)
    .flatMap((record, index) => {
      const orderItem = normalizeInstacartOrderRecord(record, sourceId, index);

      if (orderItem) {
        return [orderItem];
      }

      const name = firstString(record, [
        "name",
        "product_name",
        "product.name",
        "item_name",
        "item.name",
        "display_name",
        "title"
      ]);

      if (!name) {
        return [];
      }

      const retailer = firstString(record, ["retailer_slug", "retailer", "retailer.name", "store", "store_name", "shop_name"]);
      const externalId =
        firstString(record, ["id", "item_id", "product_id", "product.id", "legacy_item_id", "retailer_item_id"]) ??
        stableId(`${retailer ?? "instacart"}:${name}:${index}`);
      const occurredAt = normalizeDate(firstString(record, ["last_purchased_at", "last_purchase_at", "purchased_at", "created_at"]));
      const purchaseCount = firstNumber(record, ["purchase_count", "times_purchased", "count"]);
      const amountKeys = ["price", "unit_price", "total", "total_price"];
      const amount = firstNumber(record, amountKeys);
      const summary = [
        retailer ? `Retailer: ${retailer}` : undefined,
        purchaseCount === undefined ? undefined : `Purchases: ${purchaseCount}`,
        occurredAt ? `Last purchased: ${occurredAt}` : undefined
      ]
        .filter(Boolean)
        .join(". ");

      return [
        {
          id: sourceItemId(sourceId, externalId),
          sourceId,
          externalId,
          kind: "grocery_order",
          occurredAt,
          title: name,
          summary: summary || "Instacart purchase history item.",
          merchantName: retailer,
          amount,
          currency: amount === undefined ? undefined : sourceCurrency(record, amountKeys),
          metadata: pickMetadata(record, ["retailer_slug", "purchase_count", "last_purchased_at", "in_stock"])
        }
      ];
    });
}

function normalizeInstacartCsvPurchaseRows(
  records: Array<Record<string, unknown>>,
  sourceId: string
): SourceItemInput[] {
  const itemRows = records.filter((record) =>
    firstString(record, ["order_id", "orderId"]) &&
    firstString(record, ["product_description", "productDescription"])
  );

  if (itemRows.length === 0) {
    return [];
  }

  const rowsByOrderId = new Map<string, Array<Record<string, unknown>>>();

  for (const row of itemRows) {
    const orderId = firstString(row, ["order_id", "orderId"]);

    if (!orderId) {
      continue;
    }

    rowsByOrderId.set(orderId, [...(rowsByOrderId.get(orderId) ?? []), row]);
  }

  return [...rowsByOrderId.entries()].flatMap(([orderId, rows]) => {
    const firstRow = rows[0];

    if (!firstRow) {
      return [];
    }

    const itemTitles = rows.flatMap((row) => {
      const title = firstString(row, ["product_description", "productDescription"]);
      return title ? [title] : [];
    });
    const retailer = firstString(firstRow, ["store_name", "storeName", "retailer_name", "retailerName", "retailer", "store"]);
    const occurredAt =
      normalizeFlexibleDate(firstString(firstRow, ["order_date", "orderDate"])) ??
      firstNormalizedDate(firstRow, ["created_at", "updated_at"]);
    const status = firstString(firstRow, ["product_order_type", "productOrderType", "order_type", "orderType", "status"]);
    const itemCount = rows.reduce((sum, row) => sum + (firstNumber(row, ["product_quantity", "productQuantity"]) ?? 1), 0);
    const amount = roundMoney(
      rows.reduce((sum, row) => sum + (firstNumber(row, ["price_paid_before_tax", "pricePaidBeforeTax", "product_price", "productPrice"]) ?? 0), 0)
    );
    const title = itemTitles.length > 0 ? itemTitles.slice(0, 3).join(", ") : `Instacart order ${orderId}`;
    // Each CSV row is one product line: keep it, not only the order total.
    const lines = rows.flatMap((row): SourceItemLine[] => {
      const name = firstString(row, ["product_description", "productDescription"]);
      if (!name) return [];
      const quantity = firstNumber(row, ["product_quantity", "productQuantity"]);
      const paid = firstNumber(row, ["price_paid_before_tax", "pricePaidBeforeTax"]);
      const unit = firstNumber(row, ["product_price", "productPrice"]);
      return [{
        name,
        ...(quantity !== undefined && quantity > 0 ? { quantity } : {}),
        ...(unit !== undefined ? { unitPrice: roundMoney(Math.abs(unit)) } : {}),
        ...(paid !== undefined ? { amount: roundMoney(Math.abs(paid)) } : {})
      }];
    });
    const summary = [
      retailer ? `Retailer: ${retailer}` : undefined,
      `Order: ${orderId}`,
      occurredAt ? `Delivered: ${occurredAt}` : undefined,
      status ? `Status: ${status}` : undefined,
      itemCount > 0 ? `Items: ${itemCount}` : undefined,
      amount === undefined ? undefined : `Item total: ${amount}`,
      itemTitles.length > 0 ? `Products: ${itemTitles.slice(0, 8).join(", ")}` : undefined
    ]
      .filter(Boolean)
      .join(". ");

    return [
      {
        id: sourceItemId(sourceId, orderId),
        sourceId,
        externalId: orderId,
        kind: "grocery_order",
        occurredAt,
        title,
        summary: summary || "Instacart grocery order.",
        merchantName: retailer,
        amount,
        ...(lines.length > 0 ? { lines } : {}),
        currency: amount === undefined ? undefined : sourceCurrency(firstRow, ["price_paid_before_tax", "product_price"]),
        metadata: {
          itemCount,
          itemTitles: itemTitles.slice(0, 40),
          orderType: status,
          paymentMethods: firstString(firstRow, ["payment_methods", "paymentMethods"])
        }
      }
    ];
  });
}

function normalizeInstacartOrderRecord(
  record: Record<string, unknown>,
  sourceId: string,
  index: number
): SourceItemInput | undefined {
  const explicitOrderId = firstString(record, ["order_id", "orderId"]);
  const hasOrderShape =
    explicitOrderId !== undefined ||
    arrayValue(readPath(record, "items")).length > 0 ||
    firstNumber(record, ["item_count", "itemCount", "total_cents", "totalCents"]) !== undefined;

  if (!hasOrderShape) {
    return undefined;
  }

  const orderId =
    explicitOrderId ??
    firstString(record, ["id"]) ??
    (extractItemTitles(record).length > 0 ? stableId(`instacart-order:${index}:${JSON.stringify(record).slice(0, 500)}`) : undefined);

  if (!orderId) {
    return undefined;
  }

  const itemTitles = extractItemTitles(record);
  const retailer = firstString(record, ["retailer_slug", "retailerSlug", "retailer_name", "retailerName", "retailer", "store", "store_name", "storeName"]);
  const occurredAt =
    normalizeFlexibleDate(readPath(record, "delivered_at")) ??
    normalizeFlexibleDate(readPath(record, "deliveredAt")) ??
    normalizeFlexibleDate(readPath(record, "placed_at")) ??
    normalizeFlexibleDate(readPath(record, "placedAt")) ??
    normalizeFlexibleDate(readPath(record, "order_date")) ??
    normalizeFlexibleDate(readPath(record, "orderDate")) ??
    normalizeFlexibleDate(readPath(record, "created_at"));
  const status = firstString(record, ["status", "order_status", "orderStatus", "order_type", "orderType", "product_order_type", "productOrderType"]);
  const itemCount = firstNumber(record, ["item_count", "itemCount", "no_of_items", "noOfItems", "product_quantity", "productQuantity"]) ?? itemTitles.length;
  const amount =
    firstNumber(record, ["total", "order_total", "orderTotal", "grand_total", "grandTotal", "amount", "price_paid_before_tax", "pricePaidBeforeTax"]) ??
    centsToAmount(firstNumber(record, ["total_cents", "totalCents"])) ??
    totalInstacartItemPrices(record);

  if (!occurredAt && amount === undefined && itemTitles.length === 0 && !status && !retailer) {
    return undefined;
  }

  const title =
    itemTitles.length > 0 ? itemTitles.slice(0, 3).join(", ") : `Instacart order ${orderId}`;
  const summary = [
    retailer ? `Retailer: ${retailer}` : undefined,
    `Order: ${orderId}`,
    occurredAt ? `Delivered: ${occurredAt}` : undefined,
    status ? `Status: ${status}` : undefined,
    itemCount > 0 ? `Items: ${itemCount}` : undefined,
    amount === undefined ? undefined : `Total: ${amount}`,
    itemTitles.length > 0 ? `Products: ${itemTitles.slice(0, 8).join(", ")}` : undefined
  ]
    .filter(Boolean)
    .join(". ");

  return {
    id: sourceItemId(sourceId, orderId),
    sourceId,
    externalId: orderId,
    kind: "grocery_order",
    occurredAt,
    title,
    summary: summary || "Instacart grocery order.",
    merchantName: retailer,
    amount,
    ...(extractLineItems(record) ? { lines: extractLineItems(record) } : {}),
    currency: amount === undefined ? undefined : sourceCurrency(record, ["total", "order_total", "orderTotal", "grand_total", "grandTotal", "amount"]),
    metadata: {
      ...pickMetadata(record, ["retailer_id", "retailer_name", "item_count", "status"]),
      itemTitles: itemTitles.slice(0, 40)
    }
  };
}

export function normalizeOutlookMessages(payload: unknown, sourceId = "source_outlook_email"): SourceItemInput[] {
  return asArrayPayload(payload)
    .slice(0, maxSourceItemsPerSync)
    .flatMap((item, index) => {
      const record = asRecord(item);

      if (!record) {
        return [];
      }

      if (isCalendarEventRecord(record)) {
        const calendarEvent = normalizeCalendarEventRecord(record, sourceId, index);
        return calendarEvent ? [calendarEvent] : [];
      }

      const subjectValue = firstString(record, ["subject", "title", "name", "message.subject", "mail.subject"]);
      const sender = senderName(record);
      const preview = firstString(record, [
        "bodyPreview",
        "body_preview",
        "preview",
        "summary",
        "snippet",
        "message.bodyPreview",
        "message.body_preview"
      ]);
      const occurredAt = firstNormalizedDate(record, [
        "receivedDateTime",
        "received_date_time",
        "received_at",
        "received",
        "sentDateTime",
        "sent_date_time",
        "createdDateTime",
        "created_date_time",
        "lastModifiedDateTime",
        "last_modified_date_time",
        "synced_at",
        "updated_at"
      ]);
      const amountKeys = ["amount", "total", "total_amount", "transaction_amount", "amount_due", "paid_amount"];
      const explicitAmount = firstNumber(record, amountKeys);

      if (!subjectValue && !sender && !preview && !occurredAt && explicitAmount === undefined) {
        return [];
      }

      const subject = subjectValue ?? "(no subject)";
      const externalId =
        firstString(record, [
          "id",
          "message_id",
          "messageId",
          "internetMessageId",
          "internet_message_id",
          "conversationId",
          "conversation_id"
        ]) ?? stableId(`${subject}:${sender ?? ""}:${index}`);
      const summary = [sender ? `From: ${sender}` : undefined, preview].filter(Boolean).join(". ");
      const receiptText = [subject, preview].filter(Boolean).join(" ");
      const amount =
        explicitAmount ??
        extractReceiptAmountFromText(receiptText);

      return [
        {
          id: sourceItemId(sourceId, externalId),
          sourceId,
          externalId,
          kind: "email",
          occurredAt,
          title: subject,
          summary: summary || "Outlook message.",
          merchantName: sender ? cleanEmailDisplayName(sender) : undefined,
          amount,
          currency: amount === undefined ? undefined : sourceCurrency(record, amountKeys) ?? inferCurrencyCodeFromText(receiptText),
          metadata: pickMetadata(record, [
            "importance",
            "inferenceClassification",
            "inference_classification",
            "parentFolderId",
            "parent_folder_id",
            "conversationId",
            "conversation_id",
            "internetMessageId",
            "internet_message_id",
            "webLink",
            "web_link",
            "hasAttachments",
            "has_attachments",
            "isRead",
            "is_read",
            "isDraft",
            "is_draft",
            "resource_type",
            "synced_at",
            "updated_at"
          ])
        }
      ];
    });
}

export function normalizeGmailMessages(payload: unknown, sourceId = "source_gmail"): SourceItemInput[] {
  return asArrayPayload(payload)
    .slice(0, maxSourceItemsPerSync)
    .flatMap((item, index) => {
      const record = asRecord(item);

      if (!record) {
        return [];
      }

      if (isCalendarEventRecord(record)) {
        const calendarEvent = normalizeCalendarEventRecord(record, sourceId, index);
        return calendarEvent ? [calendarEvent] : [];
      }

      const subject = gmailHeader(record, "Subject") ?? firstString(record, ["subject", "title", "name"]) ?? "(no subject)";
      const sender = gmailHeader(record, "From") ?? firstString(record, ["from", "sender", "sender_name", "sender_address"]);
      const externalId = firstString(record, ["id", "message_id", "messageId", "threadId"]) ?? stableId(`${subject}:${sender ?? ""}:${index}`);
      const internalDate = firstString(record, ["internalDate", "internal_date"]);
      const occurredAt =
        normalizeEpochMilliseconds(internalDate) ??
        normalizeDate(gmailHeader(record, "Date") ?? firstString(record, ["internalDateIso", "date", "received_at", "created_at"]));
      const preview = firstString(record, ["snippet", "bodyPreview", "preview", "summary"]);
      const summary = [sender ? `From: ${sender}` : undefined, preview].filter(Boolean).join(". ");
      const receiptText = [subject, preview].filter(Boolean).join(" ");
      const amountKeys = ["amount", "total", "total_amount", "transaction_amount"];
      const amount =
        firstNumber(record, amountKeys) ??
        extractReceiptAmountFromText(receiptText);

      return [
        {
          id: sourceItemId(sourceId, externalId),
          sourceId,
          externalId,
          kind: "email",
          occurredAt,
          title: subject,
          summary: summary || "Gmail message.",
          merchantName: sender ? cleanEmailDisplayName(sender) : undefined,
          amount,
          currency: amount === undefined ? undefined : sourceCurrency(record, amountKeys) ?? inferCurrencyCodeFromText(receiptText),
          metadata: pickMetadata(record, ["threadId", "labelIds", "historyId"])
        }
      ];
    });
}

function normalizeCalendarEventRecord(
  record: Record<string, unknown>,
  sourceId: string,
  index: number
): SourceItemInput | null {
  if (!isCalendarEventRecord(record)) {
    return null;
  }

  const title = firstString(record, ["summary", "title", "subject", "name"]) ?? "(calendar event)";
  const description = firstString(record, ["description", "bodyPreview", "body_preview", "preview", "snippet"]);
  const preview = description?.replace(/\s+/g, " ").trim().slice(0, 600);
  const externalId =
    firstString(record, ["uid", "id", "event_id", "eventId", "iCalUID", "ical_uid"]) ??
    stableId(`${title}:${firstString(record, ["start", "date"]) ?? ""}:${index}`);
  const occurredAt = firstNormalizedDate(record, ["start", "dtstart", "date", "started_at", "startedAt"]);
  const endsAt = firstString(record, ["end", "dtend", "ends_at", "endsAt"]);
  const location = firstString(record, ["location", "place", "venue"]);
  const organizer = firstString(record, ["organizer", "from", "sender", "sender_name"]);
  const status = firstString(record, ["status"]);
  const url = firstString(record, ["url", "htmlLink", "webLink", "web_link"]);
  const amountKeys = ["amount", "total", "total_amount", "transaction_amount"];
  const receiptText = [title, preview].filter(Boolean).join(" ");
  const amount = firstNumber(record, amountKeys) ?? extractReceiptAmountFromText(receiptText);

  if (!isFinanceRelevantCalendarText({ amount, location, organizer, preview, title, url })) {
    return null;
  }

  const summary = [
    location ? `Location: ${location}` : undefined,
    occurredAt ? `Starts: ${occurredAt}` : undefined,
    endsAt ? `Ends: ${endsAt}` : undefined,
    organizer ? `Organizer: ${organizer}` : undefined,
    status ? `Status: ${status}` : undefined,
    amount === undefined ? undefined : `Total: ${amount}`,
    preview,
    url ? `URL: ${url}` : undefined
  ]
    .filter(Boolean)
    .join(". ");

  return {
    id: sourceItemId(sourceId, externalId),
    sourceId,
    externalId,
    kind: "calendar_event",
    occurredAt,
    title,
    summary: summary || "Calendar event.",
    merchantName: inferCalendarMerchantName(title, preview, organizer),
    amount,
    currency: amount === undefined ? undefined : sourceCurrency(record, amountKeys) ?? inferCurrencyCodeFromText(receiptText),
    metadata: pickMetadata(record, ["uid", "source_format", "location", "organizer", "status", "url"])
  };
}

function isCalendarEventRecord(record: Record<string, unknown>): boolean {
  const sourceFormat = firstString(record, ["source_format", "sourceFormat"]);
  const explicitFlag = firstString(record, ["calendar_event", "calendarEvent"]);

  return Boolean(
    sourceFormat === "ical" ||
      explicitFlag === "true" ||
      (firstString(record, ["uid", "iCalUID", "ical_uid"]) &&
        firstString(record, ["start", "dtstart", "date"]) &&
        firstString(record, ["summary", "title", "subject"]))
  );
}

function inferCalendarMerchantName(
  title: string,
  preview: string | undefined,
  organizer: string | undefined
): string | undefined {
  const text = [title, preview, organizer].filter(Boolean).join(" ");

  if (/airbnb/i.test(text)) {
    return "Airbnb";
  }

  if (/vrbo/i.test(text)) {
    return "VRBO";
  }

  return organizer ? cleanEmailDisplayName(organizer) : undefined;
}

function isFinanceRelevantCalendarText({
  amount,
  location,
  organizer,
  preview,
  title,
  url
}: {
  amount?: number;
  location?: string;
  organizer?: string;
  preview?: string;
  title: string;
  url?: string;
}): boolean {
  if (amount !== undefined) {
    return true;
  }

  const text = [title, preview, organizer, location, url].filter(Boolean).join(" ");

  return /(?:[$€£₹]\s*\d|\b(?:airbnb|vrbo|hotel|lodging|stay|flight|airline|train|rail|ticket|itinerary|trip|travel|reservation|booking|receipt|invoice|order|payment|paid|total|fare|rental\s+car|car\s+rental|uber|lyft|taxi|restaurant|dinner|lunch|doordash|instacart|amazon)\b)/i.test(text);
}

export function normalizeAmazonOrders(payload: unknown, sourceId = "source_amazon_orders"): SourceItemInput[] {
  return asArrayPayload(payload)
    .slice(0, maxSourceItemsPerSync)
    .flatMap((item, index) => {
      const record = asRecord(item);

      if (!record) {
        return [];
      }

      const externalId =
        firstString(record, ["orderId", "order_id", "id", "amazonOrderId", "transactionId", "transaction_id"]) ??
        stableId(`amazon:${index}:${JSON.stringify(record).slice(0, 500)}`);
      const occurredAt = normalizeDate(firstString(record, ["placedDate", "placed_date", "orderDate", "order_date", "date", "transactionDate", "transaction_date"]));
      const amountKeys = ["total", "grandTotal", "grand_total", "orderTotal", "order_total", "amount", "signedAmount", "signed_amount"];
      const amount = firstNumber(record, amountKeys);
      const itemTitles = extractItemTitles(record);
      const lines = extractLineItems(record);
      const explicitTitle = firstString(record, ["title", "name", "description"]);
      const title = explicitTitle ?? (itemTitles.length > 0 ? itemTitles.slice(0, 2).join(", ") : `Amazon order ${externalId}`);
      const status = firstString(record, ["status", "orderStatus", "shipmentStatus"]);
      const seller = firstString(record, ["seller", "sellerName", "merchant", "merchantName"]);

      if (!occurredAt && amount === undefined && itemTitles.length === 0 && !explicitTitle && !status && !seller) {
        return [];
      }

      const summary = [
        `Order: ${externalId}`,
        status ? `Status: ${status}` : undefined,
        seller ? `Seller: ${seller}` : undefined,
        amount === undefined ? undefined : `Total: ${amount}`,
        itemTitles.length > 0 ? `Items: ${itemTitles.slice(0, 6).join(", ")}` : undefined
      ]
        .filter(Boolean)
        .join(". ");

      return [
        {
          id: sourceItemId(sourceId, externalId),
          sourceId,
          externalId,
          kind: "order",
          occurredAt,
          title,
          summary: summary || "Amazon order.",
          merchantName: seller ?? "Amazon",
          amount,
          ...(lines ? { lines } : {}),
          currency: amount === undefined ? undefined : sourceCurrency(record, amountKeys),
          metadata: pickMetadata(record, ["orderId", "order_id", "status", "paymentMethod", "payment_method", "payments", "shipTo", "asin", "trackingNumber"])
        }
      ];
    });
}

export function normalizeAirbnbWishlist(payload: unknown, sourceId = "source_airbnb"): SourceItemInput[] {
  const records = asArrayPayload(payload)
    .flatMap((item, index) => {
      const record = asRecord(item);
      return record ? [{ index, record }] : [];
    });
  const reservations = records
    .flatMap(({ index, record }) => {
      const reservation = normalizeAirbnbReservationRecord(record, sourceId, index);
      return reservation ? [reservation] : [];
    })
    .slice(0, maxSourceItemsPerSync);

  if (reservations.length > 0) {
    return reservations;
  }

  return records
    .slice(0, maxSourceItemsPerSync)
    .flatMap(({ index, record }) => {
      if (isCalendarEventRecord(record)) {
        return [];
      }

      const title = firstString(record, [
        "title",
        "name",
        "listing_title",
        "listing.title",
        "listing.name",
        "listing.localizedListingName",
        "listing.pdpDisplayExtensions.title",
        "wishlist_name",
        "wishlist.name"
      ]) ?? fallbackAirbnbTitle(record);

      if (!title) {
        return [];
      }

      const externalId =
        firstString(record, [
          "id",
          "listing_id",
          "listingId",
          "room_id",
          "url",
          "listing_url",
          "listing.id",
          "listing.listingId",
          "listing.room_id"
        ]) ??
        stableId(`${title}:${index}`);
      const occurredAt =
        firstNormalizedDate(record, [
          "updated_at",
          "checked_at",
          "created_at",
          "date",
          "timestamp",
          "last_seen_at",
          "synced_at",
          "last_checked_at",
          "last_drop_at",
          "snapshot_at",
          "added_at"
        ]);
      const location = firstString(record, [
        "location",
        "city",
        "market",
        "listing.location",
        "listing.city",
        "listing.publicAddress",
        "listing.locationTitle"
      ]);
      const url = firstString(record, ["url", "listing_url", "airbnb_url", "listing.url", "direct_url"]);
      const directUrl = firstString(record, ["direct_url", "direct.url"]);
      const amountKeys = [
        "total",
        "price",
        "nightly_price",
        "airbnb_total",
        "direct_total",
        "last_price",
        "max_price",
        "total_price",
        "pricing.total",
        "price.total",
        "current_price",
        "new_price",
        "after.total",
        "after.price"
      ];
      const amount = firstNumber(record, amountKeys);
      const summary = [
        location ? `Location: ${location}` : undefined,
        firstString(record, ["platform"]) ? `Platform: ${firstString(record, ["platform"])}` : undefined,
        firstString(record, ["checkin"]) ? `Check-in: ${firstString(record, ["checkin"])}` : undefined,
        firstString(record, ["checkout"]) ? `Check-out: ${firstString(record, ["checkout"])}` : undefined,
        firstString(record, ["listing_ids"]) ? `Listings: ${firstString(record, ["listing_ids"])}` : undefined,
        amount === undefined ? undefined : `Price: ${amount}`,
        url ? `URL: ${url}` : undefined,
        directUrl && directUrl !== url ? `Direct URL: ${directUrl}` : undefined
      ]
        .filter(Boolean)
        .join(". ");

      return [
        {
          id: sourceItemId(sourceId, externalId),
          sourceId,
          externalId,
          kind: "travel_listing",
          occurredAt,
          title,
          summary: summary || "Airbnb travel context.",
          merchantName: airbnbMerchantName(record),
          amount,
          currency: amount === undefined ? undefined : sourceCurrency(record, amountKeys),
          metadata: pickMetadata(record, [
            "listing_id",
            "room_id",
            "url",
            "listing_url",
            "direct_url",
            "savings",
            "platform",
            "checkin",
            "checkout",
            "cleaning_fee",
            "service_fee",
            "tax"
          ])
        }
      ];
    });
}

function normalizeAirbnbReservationRecord(
  record: Record<string, unknown>,
  sourceId: string,
  index: number
): SourceItemInput | null {
  const confirmationCode = firstString(record, [
    "confirmation_code",
    "confirmationCode",
    "confirmation",
    "confirmation_number",
    "confirmationNumber",
    "reservation_code",
    "reservationCode",
    "reservation_id",
    "reservationId",
    "booking_id",
    "bookingId",
    "trip_id",
    "tripId"
  ]);
  const checkIn = firstString(record, [
    "check_in",
    "checkIn",
    "checkin",
    "start",
    "dtstart",
    "start_date",
    "startDate",
    "date",
    "arrival",
    "arrival_date",
    "arrivalDate"
  ]);
  const checkOut = firstString(record, [
    "check_out",
    "checkOut",
    "checkout",
    "end",
    "dtend",
    "end_date",
    "endDate",
    "departure",
    "departure_date",
    "departureDate"
  ]);
  const amountKeys = [
    "amount",
    "total",
    "total_paid",
    "totalPaid",
    "total_price",
    "totalPrice",
    "grand_total",
    "grandTotal",
    "reservation_total",
    "reservationTotal",
    "booking_total",
    "bookingTotal",
    "payout",
    "paid"
  ];
  const receiptText = [
    firstString(record, ["summary", "title", "subject", "name"]),
    firstString(record, ["description", "bodyPreview", "body_preview", "preview", "snippet"])
  ]
    .filter(Boolean)
    .join(" ");
  const amount = firstNumber(record, amountKeys) ?? extractReceiptAmountFromText(receiptText);
  const title = firstString(record, [
    "summary",
    "subject",
    "listing",
    "listing_name",
    "listingName",
    "listing_title",
    "listingTitle",
    "property",
    "property_name",
    "propertyName",
    "name",
    "title"
  ]);

  if (!confirmationCode && isAirbnbListingContextRecord(record)) {
    return null;
  }

  const hasReservationShape =
    Boolean(checkIn || checkOut) &&
    (amount !== undefined ||
      Boolean(firstString(record, ["reservation_status", "reservationStatus", "trip_status", "tripStatus", "guest", "guest_name", "guestName"])));

  if (!confirmationCode && !hasReservationShape) {
    return null;
  }

  const externalId = confirmationCode ?? stableId([title, checkIn, checkOut, amount, index].filter(Boolean).join(":"));
  const occurredAt = firstNormalizedDate(record, [
    "booked_at",
    "bookedAt",
    "booking_date",
    "bookingDate",
    "created_at",
    "createdAt",
    "reservation_date",
    "reservationDate",
    "date",
    "check_in",
    "checkIn",
    "checkin",
    "start",
    "dtstart",
    "start_date",
    "startDate",
    "arrival",
    "arrival_date",
    "arrivalDate"
  ]);
  const location = firstString(record, ["location", "city", "market", "address"]);
  const status = firstString(record, ["status", "reservation_status", "reservationStatus", "trip_status", "tripStatus"]);
  const host = firstString(record, ["host", "host_name", "hostName"]);
  const guest = firstString(record, ["guest", "guest_name", "guestName"]);
  const nights = firstString(record, ["nights", "night_count", "nightCount"]);
  const url = firstString(record, ["url", "reservation_url", "reservationUrl", "trip_url", "tripUrl", "listing_url", "listingUrl"]);
  const preview = firstString(record, ["description", "bodyPreview", "body_preview", "preview", "snippet"])?.replace(/\s+/g, " ").trim().slice(0, 600);

  if (
    !confirmationCode &&
    !isFinanceRelevantCalendarText({
      amount,
      location,
      organizer: host,
      preview,
      title: title ?? "",
      url
    })
  ) {
    return null;
  }

  const summary = [
    location ? `Location: ${location}` : undefined,
    checkIn ? `Check-in: ${checkIn}` : undefined,
    checkOut ? `Check-out: ${checkOut}` : undefined,
    nights ? `Nights: ${nights}` : undefined,
    status ? `Status: ${status}` : undefined,
    amount === undefined ? undefined : `Total: ${amount}`,
    host ? `Host: ${host}` : undefined,
    guest ? `Guest: ${guest}` : undefined,
    preview,
    url ? `URL: ${url}` : undefined
  ]
    .filter(Boolean)
    .join(". ");

  return {
    id: sourceItemId(sourceId, externalId),
    sourceId,
    externalId,
    kind: "travel_booking",
    occurredAt,
    title: title ?? `Airbnb reservation ${externalId}`,
    summary: summary || "Airbnb reservation.",
    merchantName: airbnbMerchantName(record),
    amount,
    currency: amount === undefined ? undefined : sourceCurrency(record, amountKeys) ?? inferCurrencyCodeFromText(receiptText),
    metadata: pickMetadata(record, [
      "confirmation_code",
      "reservation_code",
      "booking_id",
      "trip_id",
      "uid",
      "source_format",
      "status",
      "host",
      "guest",
      "nights",
      "url",
      "reservation_url",
      "trip_url"
    ])
  };
}

function isAirbnbListingContextRecord(record: Record<string, unknown>): boolean {
  const id = firstString(record, ["id"]);

  return Boolean(
    id?.startsWith("price:") ||
      firstString(record, [
        "listing_id",
        "listingId",
        "room_id",
        "snapshot_at",
        "last_price",
        "max_price",
        "new_price",
        "after.price",
        "listing_url",
        "listingUrl"
      ])
  );
}

function fallbackAirbnbTitle(record: Record<string, unknown>): string | undefined {
  const platform = airbnbMerchantName(record);
  const listingId = firstString(record, ["listing_id", "listingId", "room_id", "listing.id", "listing.listingId"]);
  const wishlistId = firstString(record, ["wishlist_id", "wishlistId", "id"]);
  const url = firstString(record, ["listing_url", "url", "airbnb_url"]);

  if (listingId) {
    return `${platform} listing ${listingId}`;
  }

  if (url) {
    return `${platform} listing ${url}`;
  }

  if (wishlistId) {
    return `${platform} wishlist ${wishlistId}`;
  }

  return undefined;
}

function airbnbMerchantName(record: Record<string, unknown>): string {
  const platform = firstString(record, ["platform"]);
  return platform && /vrbo/i.test(platform) ? "VRBO" : "Airbnb";
}

interface SourceImportParseOptions {
  contentEncoding?: "base64" | "text";
  filename?: string;
}

export function parseSourceImportContent(content: string, options: SourceImportParseOptions = {}): unknown {
  const trimmed = stripByteOrderMark(content).trim();

  if (!trimmed) {
    throw new SourceAdapterError("Import content is empty.");
  }

  if (options.contentEncoding === "base64") {
    const decoded = Buffer.from(trimmed, "base64");

    if (isZipBuffer(decoded) || isZipFilename(options.filename)) {
      return parseZipImportContent(decoded);
    }

    return parseSourceImportContent(decoded.toString("utf8"), { filename: options.filename });
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const jsonRows: unknown[] = [];
    let jsonLineError: number | undefined;

    for (const [index, line] of lines.entries()) {
      try {
        jsonRows.push(JSON.parse(line) as unknown);
      } catch {
        jsonLineError = index + 1;
        break;
      }
    }

    if (jsonLineError === undefined && jsonRows.length > 0) {
      return jsonRows;
    }

    if (isZipFilename(options.filename)) {
      throw new SourceAdapterError("ZIP source imports must be uploaded as a file, not pasted as text.");
    }

    const calendarRows = parseIcalImportContent(trimmed);

    if (calendarRows.length > 0) {
      return calendarRows;
    }

    const csvRows = parseCsvImportContent(trimmed);

    if (csvRows.length > 0) {
      return csvRows;
    }

    const emailRows = parseEmailImportContent(trimmed);

    if (emailRows.length > 0) {
      return emailRows;
    }

    throw new SourceAdapterError(
      `Import content is not valid JSON, JSONL, CSV, EML, MBOX, ICS, or ZIP${jsonLineError ? ` at line ${jsonLineError}` : ""}.`
    );
  }
}

function parseZipImportContent(buffer: Buffer): unknown {
  const entries = readZipTextEntries(buffer);

  if (entries.length === 0) {
    throw new SourceAdapterError("ZIP import did not contain supported source files.");
  }

  const parsedEntries = entries.map((entry) => parseSourceImportContent(entry.content, { filename: entry.name }));

  if (parsedEntries.length === 1) {
    return parsedEntries[0];
  }

  return parsedEntries.flatMap((entry) => asArrayPayload(entry));
}

function readZipTextEntries(buffer: Buffer): Array<{ content: string; name: string }> {
  const centralDirectory = findEndOfCentralDirectory(buffer);

  if (!centralDirectory) {
    throw new SourceAdapterError("ZIP import is invalid or unsupported.");
  }

  const entries: Array<{ content: string; name: string }> = [];
  let offset = centralDirectory.offset;
  let decodedBytes = 0;

  for (let index = 0; index < centralDirectory.entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new SourceAdapterError("ZIP import has an invalid central directory.");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const filenameStart = offset + 46;
    const filenameEnd = filenameStart + filenameLength;
    const name = buffer.slice(filenameStart, filenameEnd).toString(flags & 0x0800 ? "utf8" : "utf8");
    offset = filenameEnd + extraLength + commentLength;

    if (name.endsWith("/") || !isSupportedZipSourceFilename(name)) {
      continue;
    }

    if (uncompressedSize > maxSourceImportBytes || decodedBytes + uncompressedSize > maxSourceImportBytes) {
      throw new SourceAdapterError(`ZIP import extracted content must be ${Math.round(maxSourceImportBytes / (1024 * 1024))} MB or smaller.`);
    }

    const content = readZipEntryContent(buffer, {
      compressedSize,
      compressionMethod,
      localHeaderOffset,
      maxDecodedBytes: maxSourceImportBytes - decodedBytes,
      name
    });
    decodedBytes += Buffer.byteLength(content, "utf8");
    entries.push({ content, name });
  }

  return entries;
}

function readZipEntryContent(
  buffer: Buffer,
  entry: { compressedSize: number; compressionMethod: number; localHeaderOffset: number; maxDecodedBytes: number; name: string }
): string {
  const offset = entry.localHeaderOffset;

  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new SourceAdapterError(`ZIP import entry ${entry.name} has an invalid local header.`);
  }

  const filenameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + filenameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > buffer.length) {
    throw new SourceAdapterError(`ZIP import entry ${entry.name} is truncated.`);
  }

  const compressed = buffer.slice(dataStart, dataEnd);

  switch (entry.compressionMethod) {
    case 0:
      if (compressed.length > entry.maxDecodedBytes) {
        throwZipInflationLimitError();
      }

      return compressed.toString("utf8");
    case 8:
      return inflateRawZipEntry(compressed, entry.maxDecodedBytes);
    default:
      throw new SourceAdapterError(`ZIP import entry ${entry.name} uses unsupported compression method ${entry.compressionMethod}.`);
  }
}

interface SyncInflateRaw {
  _processChunk(chunk: Buffer, flushFlag: number): Buffer;
}

function inflateRawZipEntry(compressed: Buffer, maxDecodedBytes: number): string {
  if (maxDecodedBytes <= 0) {
    throwZipInflationLimitError();
  }

  const inflate = createInflateRaw({
    maxOutputLength: maxDecodedBytes
  }) as unknown as SyncInflateRaw;

  try {
    return inflate._processChunk(compressed, zlibConstants.Z_FINISH).toString("utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") {
      throwZipInflationLimitError();
    }

    throw error;
  }
}

function throwZipInflationLimitError(): never {
  throw new SourceAdapterError(`ZIP import extracted content must be ${Math.round(maxSourceImportBytes / (1024 * 1024))} MB or smaller.`);
}

function findEndOfCentralDirectory(buffer: Buffer): { entryCount: number; offset: number } | null {
  const minimumOffset = Math.max(0, buffer.length - 65_557);

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) {
      continue;
    }

    return {
      entryCount: buffer.readUInt16LE(offset + 10),
      offset: buffer.readUInt32LE(offset + 16)
    };
  }

  return null;
}

function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

function isZipFilename(filename: string | undefined): boolean {
  return Boolean(filename && /\.zip$/i.test(filename));
}

function isSupportedZipSourceFilename(filename: string): boolean {
  return /\.(json|jsonl|csv|eml|mbox|ics|ical|txt)$/i.test(filename);
}

function parseIcalImportContent(content: string): Array<Record<string, string>> {
  const unfolded = unfoldIcalLines(content);
  const firstContentLine = unfolded.find((line) => line.trim().length > 0)?.trim().toUpperCase();

  if (firstContentLine !== "BEGIN:VCALENDAR") {
    return [];
  }

  const events: Array<Record<string, string>> = [];
  let activeEvent: Record<string, string> | undefined;

  for (const line of unfolded) {
    const trimmed = line.trim();

    if (trimmed.toUpperCase() === "BEGIN:VEVENT") {
      activeEvent = {};
      continue;
    }

    if (trimmed.toUpperCase() === "END:VEVENT") {
      if (activeEvent && Object.keys(activeEvent).length > 0) {
        const record = calendarEventRecord(activeEvent);

        if (record) {
          events.push(record);
        }
      }
      activeEvent = undefined;
      continue;
    }

    if (!activeEvent) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const rawKey = trimmed.slice(0, separatorIndex);
    const value = decodeIcalValue(trimmed.slice(separatorIndex + 1));
    const key = rawKey.split(";")[0]?.trim().toUpperCase();

    switch (key) {
      case "UID":
        activeEvent.uid = value;
        break;
      case "SUMMARY":
        activeEvent.summary = value;
        break;
      case "DESCRIPTION":
        activeEvent.description = value;
        break;
      case "LOCATION":
        activeEvent.location = value;
        break;
      case "DTSTART":
        activeEvent.start = normalizeIcalDate(value) ?? value;
        break;
      case "DTEND":
        activeEvent.end = normalizeIcalDate(value) ?? value;
        break;
      case "URL":
        activeEvent.url = value;
        break;
      case "ORGANIZER":
        activeEvent.organizer = cleanIcalOrganizer(value);
        break;
      case "STATUS":
        activeEvent.status = value;
        break;
      default:
        break;
    }
  }

  return events;
}

function calendarEventRecord(event: Record<string, string>): Record<string, string> | undefined {
  const title = event.summary || event.description;
  const date = event.start;

  if (!title && !date && !event.location && !event.uid) {
    return undefined;
  }

  const description = event.description ?? "";
  const externalId = event.uid || stableId([title, date, event.location].filter(Boolean).join(":"));
  const confirmationCode = extractTravelConfirmationCode(description);

  return {
    bodyPreview: description,
    calendar_event: "true",
    confirmation_code: confirmationCode ?? "",
    date: date ?? "",
    description,
    end: event.end ?? "",
    from: event.organizer ?? "",
    id: externalId,
    location: event.location ?? "",
    organizer: event.organizer ?? "",
    preview: description,
    source_format: "ical",
    start: date ?? "",
    status: event.status ?? "",
    subject: title ?? "(calendar event)",
    summary: title ?? "",
    title: title ?? "(calendar event)",
    uid: externalId,
    url: event.url ?? ""
  };
}

function unfoldIcalLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded: string[] = [];

  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }

    unfolded.push(line);
  }

  return unfolded;
}

function decodeIcalValue(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function normalizeIcalDate(value: string): string | undefined {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);

  if (dateOnly) {
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);

  if (dateTime) {
    const iso = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}${dateTime[7] ? "Z" : ""}`;
    return normalizeDate(iso);
  }

  return normalizeDate(value);
}

function cleanIcalOrganizer(value: string): string {
  return value.replace(/^mailto:/i, "").trim();
}

function extractTravelConfirmationCode(value: string): string | undefined {
  const match = /\bconfirmation(?:\s+(?:code|number))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/i.exec(value);
  return match?.[1]?.toUpperCase();
}

function parseEmailImportContent(content: string): Array<Record<string, string>> {
  const normalized = content.replace(/\r\n/g, "\n");
  const blocks = splitMboxMessages(normalized);
  const candidates = blocks.length > 0 ? blocks : [normalized];

  return candidates.flatMap((block) => {
    const message = parseEmailMessage(block);
    return message ? [message] : [];
  });
}

function splitMboxMessages(content: string): string[] {
  const lines = content.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let sawSeparator = false;

  for (const line of lines) {
    if (/^From\s+\S+/.test(line)) {
      if (current.some((candidate) => candidate.trim().length > 0)) {
        blocks.push(current.join("\n"));
      }
      current = [];
      sawSeparator = true;
      continue;
    }

    current.push(line);
  }

  if (sawSeparator && current.some((candidate) => candidate.trim().length > 0)) {
    blocks.push(current.join("\n"));
  }

  return sawSeparator ? blocks : [];
}

function parseEmailMessage(block: string): Record<string, string> | undefined {
  const headerSplit = block.search(/\n\s*\n/);

  if (headerSplit === -1) {
    return undefined;
  }

  const headers = parseEmailHeaders(block.slice(0, headerSplit));
  const subject = headers.subject;
  const from = headers.from;
  const date = headers.date;
  const messageId = headers["message-id"];

  if (!subject && !from && !date && !messageId) {
    return undefined;
  }

  const preview = emailBodyPreview(block.slice(headerSplit).trim());
  const externalId = messageId ?? stableId([subject, from, date, preview].filter(Boolean).join(":"));

  return {
    bodyPreview: preview,
    date: date ?? "",
    from: from ?? "",
    id: externalId,
    message_id: externalId,
    received_at: date ?? "",
    snippet: preview,
    subject: subject ?? "(no subject)",
    to: headers.to ?? ""
  };
}

function parseEmailHeaders(headerText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let activeHeader: string | undefined;

  for (const line of headerText.split("\n")) {
    if (/^[\t ]/.test(line) && activeHeader) {
      headers[activeHeader] = `${headers[activeHeader]} ${line.trim()}`.trim();
      continue;
    }

    const match = /^([^:]+):\s*(.*)$/.exec(line);

    if (!match) {
      activeHeader = undefined;
      continue;
    }

    activeHeader = match[1].trim().toLowerCase();
    headers[activeHeader] = match[2].trim();
  }

  return headers;
}

function emailBodyPreview(body: string): string {
  return body
    .replace(/^--[^\n]+$/gm, " ")
    .replace(/^Content-[^\n]+$/gim, " ")
    .replace(/=\r?\n/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function parseCsvImportContent(content: string): Array<Record<string, string>> {
  const rows = parseCsvRows(content)
    .map((row) => row.map(cleanCsvCell))
    .filter((row) => row.some((cell) => cell.length > 0));
  const headerIndex = bestCsvHeaderIndex(rows);

  if (headerIndex === -1) {
    return [];
  }

  const headers = rows[headerIndex] ?? [];
  const records = rows.slice(headerIndex + 1).flatMap((row) => {
    const record: Record<string, string> = {};

    for (const [index, header] of headers.entries()) {
      const value = row[index]?.trim() ?? "";

      if (!header.trim() || value.length === 0) {
        continue;
      }

      assignCsvValue(record, header, value);
    }

    return Object.keys(record).length > 0 ? [record] : [];
  });

  return records;
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let insideQuote = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "\"") {
      if (insideQuote && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        insideQuote = !insideQuote;
      }
      continue;
    }

    if (char === "," && !insideQuote) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuote) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);

  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function bestCsvHeaderIndex(rows: string[][]): number {
  let bestIndex = -1;
  let bestScore = 0;

  for (const [index, row] of rows.entries()) {
    const score = csvHeaderScore(row);

    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? bestIndex : -1;
}

function csvHeaderScore(row: string[]): number {
  const knownHeaders = new Set([
    "amount",
    "arrival",
    "arrival date",
    "booking date",
    "booking id",
    "booking total",
    "check in",
    "check out",
    "city",
    "confirmation",
    "confirmation code",
    "confirmation number",
    "currency",
    "date",
    "departure",
    "departure date",
    "grand total",
    "guest",
    "guest name",
    "host",
    "host name",
    "invoice url",
    "item number asin",
    "items",
    "listing",
    "listing name",
    "listing title",
    "location",
    "nights",
    "no of items",
    "order date",
    "order id",
    "order type",
    "order url",
    "payment methods",
    "payments",
    "price paid before tax",
    "product description",
    "product order type",
    "product price",
    "product quantity",
    "purchased item description",
    "reservation code",
    "reservation date",
    "reservation id",
    "reservation status",
    "reservation total",
    "refund total",
    "shipping address",
    "start date",
    "status",
    "store name",
    "sub total",
    "tax",
    "total",
    "total paid",
    "total price",
    "trip id",
    "trip status",
    "trip url"
  ]);

  return row.reduce((score, header) => {
    const normalized = normalizeCsvHeaderLabel(header);
    return score + (knownHeaders.has(normalized) ? 1 : 0);
  }, 0);
}

function assignCsvValue(record: Record<string, string>, header: string, value: string): void {
  const rawKey = stripByteOrderMark(header).trim();
  const snakeKey = csvHeaderToSnakeCase(rawKey);
  const camelKey = snakeToCamelCase(snakeKey);

  for (const key of new Set([rawKey, snakeKey, camelKey])) {
    if (key.length > 0 && !(key in record)) {
      record[key] = value;
    }
  }
}

function cleanCsvCell(value: string): string {
  const trimmed = stripByteOrderMark(value).trim();

  if (/^'[A-Za-z0-9]/.test(trimmed)) {
    return trimmed.slice(1);
  }

  return trimmed;
}

function csvHeaderToSnakeCase(header: string): string {
  return normalizeCsvHeaderLabel(header).replace(/\s+/g, "_");
}

function normalizeCsvHeaderLabel(header: string): string {
  return stripByteOrderMark(header)
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snakeToCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function stripByteOrderMark(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function roundMoney(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

function sourcePromise<T>(task: () => Promise<T>, fallback: string): Effect.Effect<T, SourceRefreshError, never> {
  return Effect.tryPromise({
    try: task,
    catch: (error) => new SourceRefreshError({ cause: error, message: syncErrorMessage(error, fallback) })
  });
}

function fetchAdapterItemsEffect(
  adapter: SourceAdapterDefinition
): Effect.Effect<AdapterFetchResult, SourceRefreshError, never> {
  return sourcePromise(
    () => fetchAdapterItems(adapter),
    `Source refresh failed for ${adapter.displayName}.`
  ).pipe(
    Effect.timeoutOrElse({
      duration: "35 seconds",
      orElse: () => Effect.fail(new SourceRefreshError({ message: `Source refresh timed out for ${adapter.displayName}.` }))
    }),
    Effect.retry(sourceRefreshRetryPolicy)
  );
}

async function ensureSourceCatalog(): Promise<void> {
  await ensureExternalSourceCatalog(
    allSourceAdapterDefinitions().map((adapter) => ({
      command: adapter.binary,
      configured: false,
      displayName: adapter.displayName,
      id: adapter.id,
      kind: adapter.kind,
      status: "stale"
    }))
  );
}

async function fetchAdapterItems(adapter: SourceAdapterDefinition): Promise<AdapterFetchResult> {
  if (adapter.mailAccount?.provider === "gmail") {
    const { rateLimited, threads } = await fetchGmailThreads(adapter.mailAccount.email);
    const items = normalizeGmailMessages(threads, adapter.id);
    return {
      items,
      sourceStatus: items.length ? "connected" : "stale",
      ...(rateLimited ? { errorMessage: gmailRateLimitedMessage(items.length), refreshFailed: true } : {})
    };
  }
  if (adapter.mailAccount?.provider === "outlook") {
    const configPath = outlookConfigPath(adapter.mailAccount);
    const refreshError = await refreshOutlookToken(configPath);
    let payload: unknown;
    try {
      payload = await runJsonCommand("outlook-email-pp-cli", [
        "--config", configPath, "messages", "list",
        "--data-source", "live", "--no-cache", "--top", "250", "--json", "--no-input",
        "--select-fields", "id,subject,from,sender,receivedDateTime,bodyPreview"
      ], 30_000);
    } catch (error) {
      // An expired token surfaces as a bare 401; the refresh failure says why.
      throw refreshError ?? error;
    }
    const items = normalizeOutlookMessages(payload, adapter.id);
    return { items, sourceStatus: items.length ? "connected" : "stale" };
  }
  switch (adapter.kind) {
    case "icloud_mail": {
      if (!adapter.mailAccount) throw new SourceAdapterError("Add an iCloud profile before syncing.");
      const result = await fetchIcloudSourceItems(adapter.mailAccount);
      return { items: result.items, sourceStatus: result.items.length ? "connected" : "stale", refreshFailed: result.hasMore || result.partial,
        errorMessage: result.hasMore ? "iCloud sync read the newest 250 messages; more mailbox history remains." : result.partial ? "Some iCloud messages could not be fetched or parsed completely." : undefined };
    }
    case "shop_orders": {
      const result = await fetchShopSourceItems();
      return {
        errorMessage: result.hasMore ? "Shop sync reached the 250-order safety cap; more order history remains." : undefined,
        items: result.items,
        refreshFailed: result.hasMore,
        sourceStatus: result.items.length > 0 ? "connected" : "stale"
      };
    }
    case "gmail": {
      const { rateLimited, threads } = await fetchGmailThreads();
      const items = normalizeAdapterItems(adapter, threads);
      return {
        errorMessage:
          items.length === 0
            ? `No local Gmail receipt/order messages returned. Run ${gmailAuthCommand}, then retry Gmail sync or import JSON/JSONL/CSV/EML/MBOX/ICS/ZIP output.`
            : rateLimited ? gmailRateLimitedMessage(items.length) : undefined,
        items,
        sourceStatus: items.length > 0 ? "connected" : "stale"
      };
    }
    case "amazon_orders": {
      const paged = await fetchAmazonOrderPages(adapter);

      if (paged) {
        return paged;
      }

      return fetchAdapterItemsWithCacheFallback(adapter, ["orders", "list", "--time-filter", "months-6", "--json", "--no-input"], {
        emptyMessage:
          "No local Amazon order rows returned. Run amazon-orders-pp-cli auth login --chrome, then amazon-orders-pp-cli sync --since 365d --agent or import JSON/JSONL/CSV output."
      });
    }
    case "instacart": {
      return fetchAdapterItemsWithCacheFallback(adapter, ["history", "list", "--limit", String(maxSourceItemsPerSync), "--json"], {
        emptyMessage:
          "No local Instacart order history returned. Run instacart-pp-cli auth login, then /pp-instacart backfill my orders or import JSONL/CSV with instacart-pp-cli history import <path> or an Instacart report export."
      });
    }
    case "outlook_email": {
      if ((await microsoftSourceOAuthStatus()).connected) {
        const payload = await fetchMicrosoftSourceRecords();
        const items = normalizeAdapterItems(adapter, payload);

        return {
          errorMessage: items.length === 0 ? "No recent Outlook messages or calendar events were returned." : undefined,
          items,
          sourceStatus: "connected"
        };
      }

      return fetchAdapterItemsWithCacheFallback(
        adapter,
        [
          "messages",
          "list",
          "--data-source",
          "local",
          "--top",
          String(maxSourceItemsPerSync),
          "--agent",
          "--select",
          "id,subject,from,sender,receivedDateTime,received_at,bodyPreview"
        ],
        {
          emptyMessage: `No local Outlook messages returned. Run ${outlookAuthCommand}, then outlook-email-pp-cli sync --resources messages --since 365d --agent.`
        }
      );
    }
    case "airbnb": {
      return fetchAdapterItemsWithCacheFallback(adapter, ["wishlist", "sync", "--agent"], {
        emptyMessage:
          "No Airbnb wishlist or travel-context rows returned. Run airbnb-pp-cli auth login --chrome, then airbnb-pp-cli wishlist sync --agent."
      });
    }
    default:
      throw new SourceAdapterError(`Unsupported source adapter kind: ${adapter.kind}`);
  }
}

function normalizeAdapterItems(adapter: SourceAdapterDefinition, payload: unknown): SourceItemInput[] {
  switch (adapter.kind) {
    case "icloud_mail":
      return normalizeOutlookMessages(payload, adapter.id);
    case "shop_orders":
      return normalizeShopOrders(payload, adapter.id);
    case "gmail":
      return normalizeGmailMessages(payload, adapter.id);
    case "amazon_orders":
      return normalizeAmazonOrders(payload, adapter.id);
    case "instacart":
      return normalizeInstacartHistory(payload, adapter.id);
    case "outlook_email":
      return normalizeOutlookMessages(payload, adapter.id);
    case "airbnb":
      return normalizeAirbnbWishlist(payload, adapter.id);
    default:
      throw new SourceAdapterError(`Unsupported source adapter kind: ${adapter.kind}`);
  }
}

// Amazon serves order history about ten orders per page; without --start-index
// a sync saw only the newest page. --agent implies --compact, which strips each
// order down to its status, so plain --json is used. A failed first page defers to the cached
// path; a failure after that keeps the pages already read.
const amazonPageSize = 10;
const amazonMaxPages = 10;
const amazonPageDelayMs = 1_500;

async function fetchAmazonOrderPages(adapter: SourceAdapterDefinition): Promise<AdapterFetchResult | undefined> {
  const items = new Map<string, SourceItemInput>();

  for (let page = 0; page < amazonMaxPages; page += 1) {
    if (page > 0) {
      await new Promise((resolve) => setTimeout(resolve, amazonPageDelayMs));
    }

    let payload: unknown;
    try {
      payload = await runJsonCommand(adapter.binary, [
        "orders", "list", "--time-filter", "months-6", "--start-index", String(page * amazonPageSize), "--json", "--no-input"
      ], 30_000);
    } catch {
      if (items.size === 0) {
        return undefined;
      }

      return {
        errorMessage: `Amazon order history stopped responding after ${items.size} orders; older orders were skipped this sync.`,
        items: [...items.values()],
        refreshFailed: true,
        sourceStatus: "connected"
      };
    }

    const before = items.size;
    for (const item of normalizeAdapterItems(adapter, payload)) {
      items.set(item.externalId, item);
    }

    if (asArrayPayload(payload).length < amazonPageSize || items.size === before) {
      break;
    }
  }

  return items.size > 0 ? { items: [...items.values()], sourceStatus: "connected" } : undefined;
}

async function fetchAdapterItemsWithCacheFallback(
  adapter: SourceAdapterDefinition,
  cliArgs: string[],
  options: { emptyMessage: string }
): Promise<AdapterFetchResult> {
  try {
    const payload = await runJsonCommand(adapter.binary, cliArgs, 30_000);
    const items = normalizeAdapterItems(adapter, payload);

    if (items.length > 0) {
      return {
        items,
        sourceStatus: "connected"
      };
    }

    const cachedItems = await readAdapterCacheItems(adapter);

    return {
      errorMessage: cachedItems.length > 0 ? undefined : options.emptyMessage,
      items: cachedItems,
      sourceStatus: cachedItems.length > 0 ? "connected" : "stale"
    };
  } catch (error) {
    const cachedItems = await readAdapterCacheItems(adapter);

    if (cachedItems.length > 0) {
      return {
        errorMessage: `Source CLI failed; imported ${cachedItems.length.toLocaleString()} records from its local cache instead.`,
        items: cachedItems,
        refreshFailed: true,
        sourceStatus: "connected"
      };
    }

    throw error;
  }
}

async function readAdapterCacheItems(adapter: SourceAdapterDefinition): Promise<SourceItemInput[]> {
  try {
    const payload = await readAdapterCachePayload(adapter);
    return payload.length > 0 ? normalizeAdapterItems(adapter, payload) : [];
  } catch {
    return [];
  }
}

async function readAdapterCachePayload(adapter: SourceAdapterDefinition): Promise<unknown[]> {
  const definition = cacheProbeForAdapter(adapter);

  if (!definition || !existsSync(definition.dbPath)) {
    return [];
  }

  switch (adapter.kind) {
    case "amazon_orders":
      return inflateSqliteJsonRows(
        await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            id,
            resource_type,
            data,
            synced_at,
            updated_at
          FROM resources
          WHERE json_valid(data) = 1
            AND (
              resource_type LIKE '%order%'
              OR lower(data) LIKE '%order%'
              OR lower(data) LIKE '%amazon%'
            )
          ORDER BY COALESCE(updated_at, synced_at) DESC
          LIMIT ${maxSourceItemsPerSync}`
        )
      );
    case "instacart":
      return [
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            o.order_id AS id,
            o.order_id,
            o.retailer_slug,
            CASE
              WHEN o.placed_at IS NULL THEN NULL
              WHEN o.placed_at > 20000000000 THEN datetime(o.placed_at / 1000, 'unixepoch')
              ELSE datetime(o.placed_at, 'unixepoch')
            END AS placed_at,
            o.status,
            o.total_cents,
            CASE
              WHEN o.total_cents IS NULL THEN NULL
              ELSE o.total_cents / 100.0
            END AS total,
            o.item_count,
            (
              SELECT json_group_array(json_object(
                'item_id', i.item_id,
                'product_id', i.product_id,
                'name', i.name,
                'quantity', i.quantity,
                'quantity_type', i.quantity_type,
                'price_cents', i.price_cents
              ))
              FROM order_items i
              WHERE i.order_id = o.order_id
            ) AS items
          FROM orders o
          ORDER BY o.placed_at DESC NULLS LAST
          LIMIT ${Math.ceil(maxSourceItemsPerSync / 2)}`
        )),
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            item_id AS id,
            product_id,
            name,
            brand,
            size,
            category,
            retailer_slug,
            purchase_count,
            CASE
              WHEN last_purchased_at IS NULL THEN NULL
              WHEN last_purchased_at > 20000000000 THEN datetime(last_purchased_at / 1000, 'unixepoch')
              ELSE datetime(last_purchased_at, 'unixepoch')
            END AS last_purchased_at,
            CASE
              WHEN last_price_cents IS NULL THEN NULL
              ELSE last_price_cents / 100.0
            END AS unit_price,
            last_in_stock AS in_stock
          FROM purchased_items
          ORDER BY last_purchased_at DESC NULLS LAST
          LIMIT ${Math.floor(maxSourceItemsPerSync / 2)}`
        ))
      ];
    case "outlook_email":
      return inflateSqliteJsonRows([
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            id,
            data,
            synced_at,
            subject,
            body_preview AS bodyPreview,
            importance,
            inference_classification AS inferenceClassification,
            parent_folder_id AS parentFolderId,
            conversation_id AS conversationId,
            internet_message_id AS internetMessageId,
            received_date_time AS receivedDateTime,
            sent_date_time AS sentDateTime,
            created_date_time AS createdDateTime,
            last_modified_date_time AS lastModifiedDateTime,
            web_link AS webLink,
            has_attachments AS hasAttachments,
            is_read AS isRead,
            is_draft AS isDraft,
            COALESCE(
              CASE WHEN json_valid(data) = 1 THEN json_extract(data, '$.from.emailAddress.name') END,
              CASE WHEN json_valid(data) = 1 THEN json_extract(data, '$.sender.emailAddress.name') END,
              CASE WHEN json_valid(data) = 1 THEN json_extract(data, '$.from.emailAddress.address') END,
              CASE WHEN json_valid(data) = 1 THEN json_extract(data, '$.sender.emailAddress.address') END
            ) AS sender
          FROM messages
          WHERE subject IS NOT NULL
            OR body_preview IS NOT NULL
            OR json_valid(data) = 1
          ORDER BY COALESCE(received_date_time, sent_date_time, created_date_time, synced_at) DESC
          LIMIT ${Math.ceil(maxSourceItemsPerSync / 2)}`
        )),
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            id,
            resource_type,
            data,
            synced_at,
            updated_at
          FROM resources
          WHERE json_valid(data) = 1
            AND (
              lower(resource_type) LIKE '%message%'
              OR lower(resource_type) LIKE '%mail%'
              OR lower(resource_type) LIKE '%outlook%'
              OR json_type(data, '$.subject') IS NOT NULL
              OR json_type(data, '$.bodyPreview') IS NOT NULL
              OR json_type(data, '$.body_preview') IS NOT NULL
            )
          ORDER BY COALESCE(updated_at, synced_at) DESC
          LIMIT ${Math.floor(maxSourceItemsPerSync / 2)}`
        ))
      ]);
    case "airbnb":
      return inflateSqliteJsonRows([
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            id,
            data,
            synced_at,
            listing_ids
          FROM airbnb_wishlist
          WHERE json_valid(data) = 1
          ORDER BY synced_at DESC
          LIMIT ${Math.ceil(maxSourceItemsPerSync / 4)}`
        )),
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            id,
            data,
            synced_at
          FROM airbnb_listing
          WHERE json_valid(data) = 1
          ORDER BY synced_at DESC
          LIMIT ${Math.ceil(maxSourceItemsPerSync / 4)}`
        )),
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            'watch:' || id AS id,
            listing_url,
            listing_id,
            platform,
            max_price,
            checkin,
            checkout,
            CASE
              WHEN added_at IS NULL THEN NULL
              WHEN added_at > 20000000000 THEN datetime(added_at / 1000, 'unixepoch')
              ELSE datetime(added_at, 'unixepoch')
            END AS added_at,
            CASE
              WHEN last_checked_at IS NULL THEN NULL
              WHEN last_checked_at > 20000000000 THEN datetime(last_checked_at / 1000, 'unixepoch')
              ELSE datetime(last_checked_at, 'unixepoch')
            END AS last_checked_at,
            last_price,
            CASE
              WHEN last_drop_at IS NULL THEN NULL
              WHEN last_drop_at > 20000000000 THEN datetime(last_drop_at / 1000, 'unixepoch')
              ELSE datetime(last_drop_at, 'unixepoch')
            END AS last_drop_at
          FROM watchlist
          ORDER BY COALESCE(last_checked_at, added_at) DESC NULLS LAST
          LIMIT ${Math.ceil(maxSourceItemsPerSync / 4)}`
        )),
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            'price:' || platform || ':' || listing_id || ':' || snapshot_at AS id,
            listing_id,
            platform,
            checkin,
            checkout,
            CASE
              WHEN snapshot_at IS NULL THEN NULL
              WHEN snapshot_at > 20000000000 THEN datetime(snapshot_at / 1000, 'unixepoch')
              ELSE datetime(snapshot_at, 'unixepoch')
            END AS snapshot_at,
            total_price,
            cleaning_fee,
            service_fee,
            tax
          FROM price_snapshots
          ORDER BY snapshot_at DESC NULLS LAST
          LIMIT ${Math.ceil(maxSourceItemsPerSync / 4)}`
        )),
        ...(await readSqliteJsonRows(
          definition.dbPath,
          `SELECT
            id,
            data,
            synced_at
          FROM resources
          WHERE json_valid(data) = 1
            AND (
              resource_type LIKE '%airbnb%'
              OR resource_type LIKE '%listing%'
              OR resource_type LIKE '%wishlist%'
              OR resource_type LIKE '%watch%'
            )
          ORDER BY updated_at DESC
          LIMIT ${Math.ceil(maxSourceItemsPerSync / 4)}`
        ))
      ]);
    case "gmail":
    default:
      return [];
  }
}

async function readSqliteJsonRows(dbPath: string, sql: string): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 5_000
  });
  const parsed = parseJsonOutput(stdout);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((row) => {
    const record = asRecord(row);
    return record ? [record] : [];
  });
}

export function inflateSqliteJsonRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.flatMap((row) => {
    const data = typeof row.data === "string" ? parseJsonObject(row.data) : asRecord(row.data);
    const columns = { ...row };
    delete columns.data;

    if (!data) {
      return [columns];
    }

    return [
      {
        ...data,
        ...columns,
        id: typeof columns.id === "string" && columns.id ? columns.id : data.id
      }
    ];
  });
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export interface SourceLiveSearchInput {
  // Inclusive YYYY-MM-DD bounds.
  from: string;
  limit?: number;
  query?: string;
  to: string;
}

export interface SourceLiveSearchResult {
  items: SourceItemInput[];
  run: SourceSyncRunRecord;
  sourceId: string;
}

// Searches a registered mailbox directly for a date window, for finding the
// email behind one transaction instead of importing a whole year. Matches are
// stored like synced items (upsert only), so they can be attached as evidence.
export async function searchSourceLive(sourceId: string, input: SourceLiveSearchInput): Promise<SourceLiveSearchResult> {
  await ensureSourceCatalog();
  const definition = allSourceAdapterDefinitions().find((adapter) => adapter.id === sourceId);

  if (!definition) {
    throw new SourceAdapterError(`Unknown source adapter: ${sourceId}`);
  }

  const account = definition.mailAccount;

  if (account?.provider !== "gmail" && account?.provider !== "outlook") {
    throw new SourceAdapterError("Live search supports registered Gmail and Outlook profiles.");
  }

  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 50);
  const endExclusive = nextCalendarDay(input.to);
  const startedAt = new Date().toISOString();
  let items: SourceItemInput[];

  if (account.provider === "gmail") {
    const query = [input.query?.trim(), `after:${input.from.replaceAll("-", "/")}`, `before:${endExclusive.replaceAll("-", "/")}`]
      .filter(Boolean)
      .join(" ");
    const payload = await runJsonCommand("gog", [
      "gmail", "search", query, "--account", account.email, "--max", String(limit),
      "--json", "--gmail-no-send", "--readonly", "--no-input"
    ], 30_000);
    const record = asRecord(payload);
    items = normalizeGmailMessages(Array.isArray(record?.threads) ? record.threads : asArrayPayload(payload), sourceId);
  } else {
    // Graph rejects $search combined with $filter or $orderby here, and the CLI
    // quotes search text so KQL date operators cannot pass through; filter the
    // window server-side and match words locally.
    const configPath = outlookConfigPath(account);
    const refreshError = await refreshOutlookToken(configPath);
    let payload: unknown;
    try {
      payload = await runJsonCommand("outlook-email-pp-cli", [
        "--config", configPath, "messages", "list", "--data-source", "live", "--no-cache", "--top", "250",
        "--filter", `receivedDateTime ge ${input.from}T00:00:00Z and receivedDateTime lt ${endExclusive}T00:00:00Z`,
        "--json", "--no-input", "--select-fields", "id,subject,from,sender,receivedDateTime,bodyPreview"
      ], 30_000);
    } catch (error) {
      throw refreshError ?? error;
    }
    const terms = input.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    items = normalizeOutlookMessages(payload, sourceId)
      .filter((item) => {
        const text = [item.title, item.summary, item.merchantName].join(" ").toLowerCase();
        return terms.every((term) => text.includes(term));
      })
      .slice(0, limit);
  }

  const run = await recordSourceSyncRun({
    finishedAt: new Date().toISOString(),
    items,
    runStatus: "succeeded",
    sourceId,
    sourceStatus: "connected",
    startedAt
  });

  return { items, run, sourceId };
}

function nextCalendarDay(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

// Microsoft access tokens last about an hour and the Outlook CLI does not
// refresh them on read. Its refresh also requests the CLI's default read-write
// scopes unless told otherwise, which Microsoft rejects for a read-only grant.
const outlookReadScopes = "Mail.Read User.Read offline_access";

async function refreshOutlookToken(configPath: string): Promise<SourceAdapterError | undefined> {
  try {
    await execFileAsync("outlook-email-pp-cli", ["--config", configPath, "auth", "refresh", "--scopes", outlookReadScopes], {
      timeout: 30_000
    });
    return undefined;
  } catch {
    return new SourceAdapterError("Outlook sign-in expired and could not be refreshed. Run koban connectors login outlook, then sync again.");
  }
}

// gog's search returns thread summaries ({ threads, nextPageToken }) carrying
// subject, from and date; selecting message fields such as payload.headers
// yields empty records. Google caps this project's per-user query cost: a
// 250-thread search is rejected while 50-100 fit, so pages stay small with a
// pause between them, and a rate-limited later page keeps earlier results.
const gmailPageSize = 50;
const gmailMaxPages = 2;
const gmailPageDelayMs = 10_000;

async function fetchGmailThreads(email?: string): Promise<{ rateLimited: boolean; threads: unknown[] }> {
  const threads: unknown[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < gmailMaxPages; page += 1) {
    if (page > 0) {
      await new Promise((resolve) => setTimeout(resolve, gmailPageDelayMs));
    }

    let payload: unknown;
    try {
      payload = await runJsonCommand("gog", [
        "gmail", "search", "newer_than:365d (receipt OR order OR invoice)",
        ...(email ? ["--account", email] : []),
        "--max", String(gmailPageSize), ...(pageToken ? ["--page", pageToken] : []),
        "--json", "--gmail-no-send", "--readonly", "--no-input"
      ], 30_000);
    } catch (error) {
      if (threads.length > 0 && error instanceof Error && /rateLimitExceeded|quota exceeded/i.test(error.message)) {
        return { rateLimited: true, threads };
      }
      throw error;
    }

    const record = asRecord(payload);
    threads.push(...(Array.isArray(record?.threads) ? record.threads : asArrayPayload(payload)));
    pageToken = typeof record?.nextPageToken === "string" && record.nextPageToken ? record.nextPageToken : undefined;

    if (!pageToken) {
      break;
    }
  }

  return { rateLimited: false, threads };
}

function gmailRateLimitedMessage(count: number): string {
  return `Gmail's per-user rate limit stopped the import after ${count} messages; the rest were skipped this sync.`;
}

async function runJsonCommand(binary: string, args: string[], timeout: number): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout
    });
    return parseJsonOutput(stdout);
  } catch (error) {
    throw new SourceAdapterError(formatSourceCommandError(error));
  }
}

type AdapterAuthState = { errorMessage?: string; status?: ExternalSourceStatus } | undefined;

// Every installed adapter's auth probe is a child-process spawn with a 5s
// ceiling, and they all run on each Settings render. Auth state does change (a
// user runs `gog auth login` in a terminal and comes back), so the window here
// is deliberately short: long enough to stop a re-render from re-spawning five
// CLIs, short enough that a fresh login shows up on the next look. The connect
// and refresh flows call invalidateSourceAdapterProbes() so a change made
// through the app is never waited on.
const adapterAuthStateTtlMs = 15_000;
const adapterAuthStateCache = new Map<string, { expiresAt: number; value: Promise<AdapterAuthState> }>();

export function invalidateSourceAdapterProbes(): void {
  adapterAuthStateCache.clear();
  commandExistsCache.clear();
}

async function checkAdapterAuthState(adapter: SourceAdapterDefinition): Promise<AdapterAuthState> {
  if (!adapter.authCheckArgs) {
    return undefined;
  }

  const cached = adapterAuthStateCache.get(adapter.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = runAdapterAuthCheck(adapter);
  adapterAuthStateCache.set(adapter.id, { expiresAt: Date.now() + adapterAuthStateTtlMs, value });
  return value;
}

async function runAdapterAuthCheck(adapter: SourceAdapterDefinition): Promise<AdapterAuthState> {
  if (!adapter.authCheckArgs) {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync(adapter.binary, adapter.authCheckArgs, {
      maxBuffer: 1024 * 1024,
      timeout: 5_000
    });
    const gogAuthState = adapter.kind === "gmail" ? parseGogAuthState(stdout) : undefined;

    if (gogAuthState) {
      return gogAuthState;
    }

    return undefined;
  } catch (error) {
    const message = formatSourceCommandError(error);

    if (/not logged in|not authenticated|no credentials|auth|login|token/i.test(message)) {
      return {
        errorMessage: friendlyAuthMessage(adapter, message),
        status: "not_configured"
      };
    }

    return {
      errorMessage: message,
      status: "error"
    };
  }
}

async function probeSourceAdapterCache(adapter: SourceAdapterDefinition): Promise<SourceAdapterCacheDiagnostic | undefined> {
  const definition = cacheProbeForAdapter(adapter);

  if (!definition) {
    return undefined;
  }

  const displayPath = displayLocalPath(definition.dbPath);

  if (!existsSync(definition.dbPath)) {
    return {
      path: displayPath,
      recordCount: 0,
      status: "missing",
      summary: "Local cache not found."
    };
  }

  const usableLabels = new Set(definition.queries.filter((query) => query.usable !== false).map((query) => query.label));

  try {
    const query = definition.queries
      .map(({ label, sql }) => `SELECT '${label.replaceAll("'", "''")}', COALESCE((${sql}), 0)`)
      .join(" UNION ALL ");
    const { stdout } = await execFileAsync("sqlite3", [definition.dbPath, query], {
      maxBuffer: 256 * 1024,
      timeout: 2_000
    });
    const rows = parseCacheProbeRows(stdout);
    const recordCount = rows
      .filter((row) => usableLabels.has(row.label))
      .reduce((sum, row) => sum + row.count, 0);

    return {
      path: displayPath,
      recordCount,
      status: recordCount > 0 ? "has_records" : "empty",
      summary: summarizeCacheProbeRows(rows)
    };
  } catch {
    return {
      path: displayPath,
      recordCount: 0,
      status: "unreadable",
      summary: "Local cache exists but could not be inspected."
    };
  }
}

function cacheProbeForAdapter(adapter: SourceAdapterDefinition): CacheProbeDefinition | undefined {
  const home = homedir();

  switch (adapter.kind) {
    case "amazon_orders":
      return {
        dbPath: path.join(home, ".local/share/amazon-orders-pp-cli/data.db"),
        queries: [
          { label: "resources", sql: "SELECT COUNT(*) FROM resources", usable: false },
          { label: "json resources", sql: "SELECT COUNT(*) FROM resources WHERE json_valid(data) = 1" },
          {
            label: "order resources",
            sql: "SELECT COUNT(*) FROM resources WHERE resource_type LIKE '%order%' AND json_valid(data) = 1"
          }
        ]
      };
    case "instacart":
      return {
        dbPath: path.join(home, "Library/Application Support/instacart/instacart.db"),
        queries: [
          { label: "orders", sql: "SELECT COUNT(*) FROM orders" },
          { label: "order items", sql: "SELECT COUNT(*) FROM order_items" },
          { label: "purchased items", sql: "SELECT COUNT(*) FROM purchased_items" },
          { label: "retailers", sql: "SELECT COUNT(*) FROM retailers", usable: false }
        ]
      };
    case "airbnb":
      return {
        dbPath: path.join(home, ".local/share/airbnb-pp-cli/data.db"),
        queries: [
          { label: "wishlist rows", sql: "SELECT COUNT(*) FROM airbnb_wishlist" },
          { label: "listing rows", sql: "SELECT COUNT(*) FROM airbnb_listing" },
          { label: "watchlist rows", sql: "SELECT COUNT(*) FROM watchlist" },
          { label: "price snapshots", sql: "SELECT COUNT(*) FROM price_snapshots" },
          { label: "resources", sql: "SELECT COUNT(*) FROM resources" }
        ]
      };
    case "outlook_email":
      return {
        dbPath: path.join(home, ".local/share/outlook-email-pp-cli/data.db"),
        queries: [
          { label: "messages", sql: "SELECT COUNT(*) FROM messages" },
          { label: "attachments", sql: "SELECT COUNT(*) FROM attachments", usable: false },
          { label: "folders", sql: "SELECT COUNT(*) FROM folders", usable: false },
          { label: "resources", sql: "SELECT COUNT(*) FROM resources", usable: false },
          {
            label: "message resources",
            sql: `SELECT COUNT(*) FROM resources
              WHERE json_valid(data) = 1
                AND (
                  lower(resource_type) LIKE '%message%'
                  OR lower(resource_type) LIKE '%mail%'
                  OR lower(resource_type) LIKE '%outlook%'
                  OR json_type(data, '$.subject') IS NOT NULL
                  OR json_type(data, '$.bodyPreview') IS NOT NULL
                  OR json_type(data, '$.body_preview') IS NOT NULL
                )`
          }
        ]
      };
    case "gmail":
    default:
      return undefined;
  }
}

function parseCacheProbeRows(output: string): Array<{ count: number; label: string }> {
  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const [label, rawCount] = line.split("|");
      const count = Number(rawCount);

      return label && Number.isFinite(count) ? [{ count, label }] : [];
    });
}

export function summarizeCacheProbeRows(rows: Array<{ count: number; label: string }>): string {
  if (rows.length === 0) {
    return "Local cache inspected; no known tables returned counts.";
  }

  return rows.map((row) => `${row.count.toLocaleString()} ${row.label}`).join(", ");
}

function displayLocalPath(filePath: string): string {
  const home = homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

function parseGogAuthState(stdout: string): { errorMessage?: string; status?: ExternalSourceStatus } | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      account?: {
        auth_preferred?: string;
        credentials_exists?: boolean;
        email?: string;
        service_account_configured?: boolean;
      };
    };
    const account = parsed.account;

    if (!account?.credentials_exists && !account?.service_account_configured && !account?.auth_preferred) {
      return {
        errorMessage: `Gmail is not authenticated. Run ${gmailAuthCommand}.`,
        status: "not_configured"
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function friendlyAuthMessage(adapter: SourceAdapterDefinition, fallback: string): string {
  switch (adapter.kind) {
    case "gmail":
      return `Gmail is not authenticated. Run ${gmailAuthCommand}.`;
    case "amazon_orders":
      return "Amazon orders is not authenticated. Run amazon-orders-pp-cli auth login --chrome.";
    case "instacart":
      return "Instacart is not authenticated. Run instacart-pp-cli auth login, then backfill order history.";
    case "airbnb":
      return "Airbnb is not authenticated. Run airbnb-pp-cli auth login --chrome.";
    case "outlook_email":
      return `Outlook email is not authenticated. Run ${outlookAuthCommand}, or use outlook-email-pp-cli auth set-token <token> if you already have an access token.`;
    default:
      return fallback;
  }
}

export function mergeAdapterStatus(
  storedStatus: ExternalSourceStatus | undefined,
  authStatus: ExternalSourceStatus | undefined,
  storage: Pick<SourceStoreSourceSummary, "sourceItemCount"> = { sourceItemCount: 0 }
): ExternalSourceStatus {
  if (storedStatus === "connected" && storage.sourceItemCount > 0) {
    return "connected";
  }

  if (authStatus === "not_configured" || authStatus === "error") {
    return authStatus;
  }

  if (authStatus === "connected") {
    return "connected";
  }

  return storedStatus ?? "stale";
}

export function formatSourceCommandError(error: unknown): string {
  const commandError = error as Error & { stderr?: string; stdout?: string };
  const raw = commandError.stderr || commandError.stdout || (error instanceof Error ? error.message : "Source command failed.");

  if (/no local data for "messages"/i.test(raw)) {
    return `No local Outlook messages returned. Run ${outlookAuthCommand}, then outlook-email-pp-cli sync --resources messages --since 365d --agent.`;
  }

  if (/missing --account|GOG_ACCOUNT|gog auth manage/i.test(raw)) {
    return `Gmail is not authenticated. Run ${gmailAuthCommand}, then set a default account with gog auth manage or GOG_ACCOUNT.`;
  }

  if (/OUTLOOK_EMAIL_TOKEN|auth set-token/i.test(raw)) {
    return `Outlook email is not authenticated. Run ${outlookAuthCommand}, or use outlook-email-pp-cli auth set-token <token> if you already have an access token.`;
  }

  if (/airbnb-pp-cli auth login --chrome/i.test(raw)) {
    return "Airbnb is not authenticated. Run airbnb-pp-cli auth login --chrome, then retry sync.";
  }

  if (/airbnb-pp-cli|\.config\/airbnb-pp-cli|no cookie file|cookies\.json/i.test(raw)) {
    return "Airbnb is not authenticated. Run airbnb-pp-cli auth login --chrome, then retry sync.";
  }

  if (/not authenticated|auth|login/i.test(raw)) {
    return raw.replace(/\s+/g, " ").trim().slice(0, 500);
  }

  const withoutWarnings = raw
    .split(/\r?\n/)
    .filter((line) => !line.trim().toLowerCase().startsWith("warning:"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return (withoutWarnings || "Source command failed.").slice(0, 500);
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();

  if (!trimmed) {
    return [];
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    for (const line of trimmed.split(/\r?\n/).map((candidate) => candidate.trim()).filter(Boolean)) {
      if (!line.startsWith("{") && !line.startsWith("[")) {
        continue;
      }

      try {
        return JSON.parse(line);
      } catch {
        // Keep trying later lines; some CLIs print a JSON envelope followed by text.
      }
    }

    const arrayStart = trimmed.indexOf("[");
    const objectStart = trimmed.indexOf("{");
    const start =
      arrayStart >= 0 && objectStart >= 0 ? Math.min(arrayStart, objectStart) : Math.max(arrayStart, objectStart);
    const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new SourceAdapterError("Source command did not return JSON.");
  }
}

function asArrayPayload(payload: unknown, depth = 0): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);

  if (!record || depth > 4) {
    return [];
  }

  for (const key of ["items", "messages", "results", "rows", "records", "orders", "history", "listings", "changes", "value"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  // "results" is an array for some CLIs and a { value: [...] } envelope for the
  // Outlook CLI, so it is checked again here as an object.
  for (const key of ["data", "result", "results", "payload", "response"]) {
    const nested = asArrayPayload(record[key], depth + 1);

    if (nested.length > 0) {
      return nested;
    }
  }

  return [record];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readPath(record, key);

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readPath(record, key);

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const nested = asRecord(value);

    if (nested) {
      const parsed = firstNumber(nested, ["amount", "value", "total", "formatted", "display"]);

      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  return undefined;
}

function extractReceiptAmountFromText(text: string): number | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return undefined;
  }

  const keywordAmounts = [
    ...normalized.matchAll(
      /\b(?:amount|balance|charged|grand total|order total|paid|payment|receipt|subtotal|total)\b[^$€£0-9]{0,32}([$€£]\s*\d+(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})/gi
    )
  ]
    .map((match) => parseReceiptAmount(match[1]))
    .filter((amount): amount is number => amount !== undefined);

  if (keywordAmounts.length > 0) {
    return Math.max(...keywordAmounts);
  }

  const explicitCurrency = [
    ...normalized.matchAll(/(?:[$€£]\s*\d+(?:,\d{3})*(?:\.\d{2})?|\b(?:usd|cad)\s+\d+\.\d{2}\b)/gi)
  ]
    .map((match) => parseReceiptAmount(match[0]))
    .filter((amount): amount is number => amount !== undefined);

  if (explicitCurrency.length > 0) {
    return Math.max(...explicitCurrency);
  }

  return undefined;
}

function parseReceiptAmount(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.round(parsed * 100) / 100;
}

function sourceCurrency(record: Record<string, unknown>, amountKeys: string[]): string | undefined {
  const explicitCurrency = firstString(record, [
    "currency",
    "currencyCode",
    "currency_code",
    "amount.currency",
    "amount.currencyCode",
    "amount.currency_code",
    "total.currency",
    "total.currencyCode",
    "total.currency_code",
    "grandTotal.currency",
    "grand_total.currency",
    "orderTotal.currency",
    "order_total.currency",
    "price.currency",
    "pricing.currency"
  ]);
  const normalizedExplicitCurrency = normalizeCurrencyCode(explicitCurrency);

  if (normalizedExplicitCurrency) {
    return normalizedExplicitCurrency;
  }

  for (const key of amountKeys) {
    const value = readPath(record, key);

    if (typeof value === "string") {
      const inferredCurrency = inferCurrencyCodeFromText(value);

      if (inferredCurrency) {
        return inferredCurrency;
      }
    }
  }

  return undefined;
}

function senderName(record: Record<string, unknown>): string | undefined {
  const sender =
    readPath(record, "from.emailAddress.name") ??
    readPath(record, "sender.emailAddress.name") ??
    readPath(record, "from.name") ??
    readPath(record, "sender.name");
  const senderAddress =
    readPath(record, "from.emailAddress.address") ??
    readPath(record, "sender.emailAddress.address") ??
    readPath(record, "from.address") ??
    readPath(record, "sender.address") ??
    readPath(record, "from.email") ??
    readPath(record, "sender.email");

  if (typeof sender === "string" && sender.trim().length > 0) {
    return sender.trim();
  }

  if (typeof senderAddress === "string" && senderAddress.trim().length > 0) {
    return senderAddress.trim();
  }

  return firstString(record, ["sender", "from", "sender_name", "sender_address"]);
}

function gmailHeader(record: Record<string, unknown>, headerName: string): string | undefined {
  const headers = readPath(record, "payload.headers");

  if (!Array.isArray(headers)) {
    return undefined;
  }

  const match = headers.find((header) => {
    const candidate = asRecord(header);
    return typeof candidate?.name === "string" && candidate.name.toLowerCase() === headerName.toLowerCase();
  });
  const value = asRecord(match)?.value;

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function cleanEmailDisplayName(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/^"|"$/g, "").trim() || value;
}

function normalizeEpochMilliseconds(value: string | undefined): string | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = new Date(Number(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function extractItemTitles(record: Record<string, unknown>): string[] {
  const titles = new Set<string>();

  for (const key of ["items", "lineItems", "line_items", "products"]) {
    const rawValue = readPath(record, key);
    const stringTitles =
      typeof rawValue === "string" && !rawValue.trim().startsWith("[") ? splitItemTitleList(rawValue) : [];

    for (const title of stringTitles) {
      titles.add(title);
    }

    const value = arrayValue(rawValue);

    for (const item of value) {
      const itemRecord = asRecord(item);
      const title = itemRecord ? firstString(itemRecord, ["title", "name", "description", "productTitle", "product_title"]) : undefined;

      if (title) {
        titles.add(title);
      }
    }
  }

  const directTitle = firstString(record, [
    "itemTitle",
    "item_title",
    "productTitle",
    "product_title",
    "asinTitle",
    "asin_title",
    "product_description",
    "productDescription",
    "purchased_item_description",
    "purchasedItemDescription"
  ]);

  if (directTitle) {
    for (const title of splitItemTitleList(directTitle)) {
      titles.add(title);
    }
  }

  return [...titles];
}

const lineItemArrayKeys = ["items", "lineItems", "line_items", "products", "orderItems", "order_items", "purchasedItems", "purchased_items"];

/**
 * The itemized lines of an order, receipt or invoice record, when it states them: each entry's name,
 * quantity, unit price and line total (positive prices paid). Cent fields are converted. A line with
 * a name and no price is kept, unpriced. Returns undefined when the record carries no line list.
 */
export function extractLineItems(record: Record<string, unknown>): SourceItemLine[] | undefined {
  for (const key of lineItemArrayKeys) {
    const entries = arrayValue(readPath(record, key));
    const lines = entries.flatMap((entry): SourceItemLine[] => {
      const item = asRecord(entry);
      if (!item) return [];
      const name = firstString(item, ["title", "name", "description", "productTitle", "product_title", "product_description", "productDescription", "itemTitle", "item_title"]);
      if (!name) return [];
      const quantity = firstNumber(item, ["quantity", "qty", "product_quantity", "productQuantity", "count"]);
      const unitPrice =
        firstNumber(item, ["unit_price", "unitPrice", "item_price", "itemPrice", "product_price", "productPrice", "price"]) ??
        centsToAmount(firstNumber(item, ["unit_price_cents", "unitPriceCents", "price_cents", "priceCents"]));
      const amount =
        firstNumber(item, ["line_total", "lineTotal", "total", "total_price", "totalPrice", "price_paid", "pricePaid", "price_paid_before_tax", "pricePaidBeforeTax", "amount"]) ??
        centsToAmount(firstNumber(item, ["line_total_cents", "lineTotalCents", "total_cents", "totalCents"]));
      return [{
        name: name.slice(0, 300),
        ...(quantity !== undefined && quantity > 0 ? { quantity } : {}),
        ...(unitPrice !== undefined ? { unitPrice: roundMoney(Math.abs(unitPrice)) } : {}),
        ...(amount !== undefined ? { amount: roundMoney(Math.abs(amount)) } : {}),
        ...(firstString(item, ["sku", "asin", "upc", "product_id", "productId"]) ? { sku: firstString(item, ["sku", "asin", "upc", "product_id", "productId"]) } : {})
      }];
    });
    if (lines.length > 0) {
      return lines.slice(0, 200);
    }
  }
  return undefined;
}

function splitItemTitleList(value: string): string[] {
  return value
    .split(/;\s*/)
    .map((title) => title.trim())
    .filter((title) => title.length > 0 && !/^see sheet\b/i.test(title))
    .slice(0, 80);
}

function totalInstacartItemPrices(record: Record<string, unknown>): number | undefined {
  const items = arrayValue(readPath(record, "items"));
  const cents = items.reduce<number>((sum, item) => {
    const itemRecord = asRecord(item);
    const itemCents = itemRecord ? firstNumber(itemRecord, ["price_cents", "priceCents"]) : undefined;
    return itemCents === undefined ? sum : sum + itemCents;
  }, 0);

  return cents > 0 ? centsToAmount(cents) : undefined;
}

function centsToAmount(cents: number | undefined): number | undefined {
  return cents === undefined ? undefined : Math.round(cents) / 100;
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function readPath(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    const nested = asRecord(value);
    return nested ? nested[segment] : undefined;
  }, record);
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  // Date-only report values must not inherit the server's local timezone.
  // Instacart exports use forms such as "Mar 31, 2026"; interpreting those
  // at UTC midnight keeps imported evidence stable across environments.
  if (/^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(value.trim())) {
    const parsed = new Date(`${value.trim()} UTC`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function firstNormalizedDate(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const normalized = normalizeFlexibleDate(readPath(record, key));

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeFlexibleDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 20_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return normalizeFlexibleDate(parsed);
    }
  }

  return typeof value === "string" ? normalizeDate(value) : undefined;
}

function pickMetadata(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = readPath(record, key);
      return value === undefined || value === null ? [] : [[key, value]];
    })
  );
}

function sourceItemId(sourceId: string, externalId: string): string {
  return `src_item_${stableId(`${sourceId}:${externalId}`)}`;
}

function stableId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 24);
}

// `sh -lc` sources the login profile on every call, so the five adapter probes
// on a Settings render cost five full shell startups. Whether a CLI is on PATH
// changes only when the user installs one, so the answer is cached briefly:
// long enough that navigating to Settings twice in a row spawns nothing, short
// enough that a fresh install shows up without restarting the server.
const commandExistsTtlMs = 60_000;
const commandExistsCache = new Map<string, { expiresAt: number; value: Promise<boolean> }>();

async function commandExists(command: string): Promise<boolean> {
  const cached = commandExistsCache.get(command);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = execFileAsync("sh", ["-lc", `command -v ${command}`], { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  commandExistsCache.set(command, { expiresAt: Date.now() + commandExistsTtlMs, value });
  return value;
}
