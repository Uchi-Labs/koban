import {
  ensureSemanticIndex,
  getSemanticDocumentSummary,
  recordAppSyncRun,
  refreshSourceEvidenceMatches,
  type AppSyncRunRecord,
  type AppSyncRunStatus
} from "@/lib/db/finance-db";
import { runServerEffect } from "@/lib/effect/runtime";
import { generateEnrichmentSuggestions, type EnrichmentRunResult } from "@/lib/enrichment-runs";
import {
  EnrichmentError,
  EvidenceMatchError,
  PlaidSyncError,
  SemanticIndexError,
  SimpleFinSyncError,
  SnapTradeSyncError,
  SourceRefreshError,
  syncErrorMessage,
  type SyncPipelineError
} from "@/lib/effect/sync-errors";
import { invalidateShellDataCache } from "@/lib/finance-data";
import { syncSourceAdaptersEffect, type SourceSyncBatchResult } from "@/lib/source-adapters";
import {
  isSnapTradeConfigured,
  skippedSnapTradeSyncResult,
  syncSnapTradeDataEffect,
  type SnapTradeSyncResult
} from "@/lib/snaptrade-server";
import {
  isSimpleFinConfigured,
  skippedSimpleFinSyncResult,
  syncSimpleFinData,
  syncSimpleFinDataEffect,
  type SimpleFinSyncResult
} from "@/lib/simplefin-server";
import {
  isPlaidConfigured,
  skippedPlaidSyncResult,
  syncPlaidData,
  syncPlaidDataEffect,
  type PlaidSyncResult
} from "@/lib/plaid-server";
import { Effect, Schedule } from "effect";
import type { Duration } from "effect";

export interface AppSyncOptions {
  enrichmentLimit?: number;
  includePlaid?: boolean;
  includeSimpleFin?: boolean;
  signal?: AbortSignal;
  sourceIds?: string[];
}

export type SyncStepStatus = "error" | "partial" | "succeeded";

type StepResult<T> = {
  data?: T;
  error?: string;
  status: SyncStepStatus;
};

const syncStepRetryPolicy = Schedule.exponential("50 millis").pipe(Schedule.compose(Schedule.recurs(2)));

export function runAppSync(options: AppSyncOptions = {}): Promise<AppSyncRunRecord> {
  return runServerEffect(runAppSyncEffect(options), { signal: options.signal });
}

export async function runSnapTradeSync(signal?: AbortSignal): Promise<{
  run: AppSyncRunRecord;
  snaptrade: SnapTradeSyncResult;
}> {
  const startedAt = new Date().toISOString();
  const snaptrade = await runServerEffect(syncSnapTradeDataEffect(), { signal });
  const finishedAt = new Date().toISOString();
  const snaptradeStatus = snaptradeSyncStepStatus(snaptrade);
  const run = await recordAppSyncRun({
    enrichmentStatus: "succeeded",
    enrichmentSummary: { skipped: true },
    errorMessage: snaptrade.errors.length > 0 ? snaptrade.errors.join(" | ") : undefined,
    finishedAt,
    plaidStatus: "succeeded",
    plaidSummary: { skipped: true },
    snaptradeStatus,
    snaptradeSummary: summarizeSnapTradeResult(snaptrade),
    sourcesStatus: "succeeded",
    sourcesSummary: { skipped: true },
    startedAt,
    status: snaptradeStatus,
  });

  invalidateShellDataCache();
  return { run, snaptrade };
}

export async function runPlaidSync(): Promise<{
  plaid: PlaidSyncResult;
  run: AppSyncRunRecord;
}> {
  const startedAt = new Date().toISOString();
  const plaid = await syncPlaidData();
  const finishedAt = new Date().toISOString();
  const plaidStatus = plaidSyncStepStatus(plaid);
  const run = await recordAppSyncRun({
    enrichmentStatus: "succeeded",
    enrichmentSummary: { skipped: true },
    errorMessage: plaid.errors.length > 0 ? plaid.errors.join(" | ") : undefined,
    finishedAt,
    plaidStatus,
    plaidSummary: summarizePlaidResult(plaid),
    simplefinStatus: "succeeded",
    simplefinSummary: { skipped: true },
    snaptradeStatus: "succeeded",
    snaptradeSummary: { skipped: true },
    sourcesStatus: "succeeded",
    sourcesSummary: { skipped: true },
    startedAt,
    status: plaidStatus,
  });

  invalidateShellDataCache();
  return { run, plaid };
}

export async function runSimpleFinSync(): Promise<{
  run: AppSyncRunRecord;
  simplefin: SimpleFinSyncResult;
}> {
  const startedAt = new Date().toISOString();
  const simplefin = await syncSimpleFinData();
  const finishedAt = new Date().toISOString();
  const simplefinStatus = simpleFinSyncStepStatus(simplefin);
  const run = await recordAppSyncRun({
    enrichmentStatus: "succeeded",
    enrichmentSummary: { skipped: true },
    errorMessage: simpleFinErrorsForMessage(simplefin.errors),
    finishedAt,
    plaidStatus: "succeeded",
    plaidSummary: { skipped: true },
    simplefinStatus,
    simplefinSummary: summarizeSimpleFinResult(simplefin),
    snaptradeStatus: "succeeded",
    snaptradeSummary: { skipped: true },
    sourcesStatus: "succeeded",
    sourcesSummary: { skipped: true },
    startedAt,
    status: simplefinStatus,
  });

  invalidateShellDataCache();
  return { run, simplefin };
}

function runAppSyncEffect(options: AppSyncOptions = {}) {
  return Effect.gen(function* () {
    const startedAt = new Date().toISOString();
    const enrichmentLimit = normalizeEnrichmentLimit(options.enrichmentLimit);
    // The three providers are independent (writes serialize inside
    // finance-db's queue), so run them concurrently — wall-clock is the
    // slowest provider instead of the sum.
    const [snapTradeRaw, plaidRaw, simpleFinRaw] = yield* Effect.all(
      [
        isSnapTradeConfigured()
          ? runSyncStepEffect(syncSnapTradeDataEffect(), {
              timeout: "2 minutes",
              timeoutError: () => new SnapTradeSyncError({ message: "SnapTrade sync timed out." })
            })
          : Effect.succeed({
              data: skippedSnapTradeSyncResult(),
              status: "succeeded" as const
            }),
        options.includePlaid && isPlaidConfigured()
          ? runSyncStepEffect(syncPlaidDataEffect(), {
              // First sync of a new item pulls up to 24 months of history — far
              // more than the steady-state cursor delta the old 2m budget assumed.
              timeout: "10 minutes",
              timeoutError: () => new PlaidSyncError({ message: "Plaid sync timed out." })
            })
          : Effect.succeed({
              data: skippedPlaidSyncResult(options.includePlaid ? "not_configured" : "manual_only"),
              status: "succeeded" as const
            }),
        options.includeSimpleFin && isSimpleFinConfigured()
          ? runSyncStepEffect(syncSimpleFinDataEffect(), {
              timeout: "10 minutes",
              timeoutError: () => new SimpleFinSyncError({ message: "SimpleFIN sync timed out." })
            })
          : Effect.succeed({
              data: skippedSimpleFinSyncResult(options.includeSimpleFin ? "not_configured" : "manual_only"),
              status: "succeeded" as const
            })
      ] as const,
      { concurrency: 3 }
    );
    const snapTradeResult = normalizeSnapTradeStep(snapTradeRaw);
    const plaidResult = normalizePlaidStep(plaidRaw);
    const simpleFinResult = normalizeSimpleFinStep(simpleFinRaw);
    const sourceResult = normalizeSourceStep(
      yield* runSyncStepEffect(syncSourceAdaptersEffect(options.sourceIds), {
        timeout: "2 minutes",
        timeoutError: () => new SourceRefreshError({ message: "Source refresh timed out." })
      })
    );
    const evidenceRefreshResult = yield* runSyncStepEffect(
      promiseSyncStepEffect(
        refreshSourceEvidenceMatches,
        (error) =>
          new EvidenceMatchError({
            cause: error,
            message: syncErrorMessage(error, "Source evidence rematch failed.")
          })
      ),
      {
        retry: true,
        timeout: "1 minute",
        timeoutError: () => new EvidenceMatchError({ message: "Source evidence rematch timed out." })
      }
    );
    const sourcesStatus = sourceStepStatus(sourceResult, evidenceRefreshResult);
    const semanticResult = yield* runSyncStepEffect(
      promiseSyncStepEffect(
        refreshSemanticIndexSummary,
        (error) =>
          new SemanticIndexError({
            cause: error,
            message: syncErrorMessage(error, "Semantic index refresh failed.")
          })
      ),
      {
        retry: true,
        timeout: "1 minute",
        timeoutError: () => new SemanticIndexError({ message: "Semantic index refresh timed out." })
      }
    );
    const enrichmentResult =
      semanticResult.status === "succeeded"
        ? normalizeEnrichmentStep(
            yield* runSyncStepEffect(
              promiseSyncStepEffect(
                () => generateEnrichmentSuggestions(enrichmentLimit),
                (error) =>
                  new EnrichmentError({
                    cause: error,
                    message: syncErrorMessage(error, "AI enrichment failed.")
                  })
              ),
              {
                timeout: "1 minute",
                timeoutError: () => new EnrichmentError({ message: "AI enrichment timed out." })
              }
            )
          )
        : {
            error: "AI enrichment skipped because the local semantic index refresh failed.",
            status: "error" as const
          };
    const finishedAt = new Date().toISOString();
    const statuses = [
      snapTradeResult.status,
      plaidResult.status,
      simpleFinResult.status,
      sourcesStatus,
      semanticResult.status,
      enrichmentResult.status
    ];

    return yield* Effect.tryPromise({
      try: () =>
        recordAppSyncRun({
          enrichmentStatus: enrichmentResult.status,
          enrichmentSummary: summarizeEnrichmentStep(enrichmentResult, semanticResult),
          errorMessage: syncRunErrorMessage([
            snapTradeResult,
            plaidResult,
            simpleFinResult,
            sourceResult,
            evidenceRefreshResult,
            semanticResult,
            enrichmentResult
          ]),
          finishedAt,
          plaidStatus: plaidResult.status,
          plaidSummary: summarizePlaidStep(plaidResult),
          simplefinStatus: simpleFinResult.status,
          simplefinSummary: summarizeSimpleFinStep(simpleFinResult),
          sourcesStatus,
          sourcesSummary: summarizeSourceStep(sourceResult, evidenceRefreshResult),
          snaptradeStatus: snapTradeResult.status,
          snaptradeSummary: summarizeSnapTradeStep(snapTradeResult),
          startedAt,
          status: syncRunStatus(statuses)
        }).then((run) => {
          invalidateShellDataCache();
          return run;
        }),
      catch: (error) => error
    });
  });
}

export function runSyncStepEffect<T, E extends SyncPipelineError>(
  step: Effect.Effect<T, E, never>,
  options: {
    retry?: boolean;
    timeout: Duration.DurationInput;
    timeoutError: () => E;
  }
): Effect.Effect<StepResult<T>, never, never> {
  const timedStep = step.pipe(
    Effect.timeoutFail({
      duration: options.timeout,
      onTimeout: options.timeoutError
    })
  );
  const retryableStep = options.retry ? timedStep.pipe(Effect.retry(syncStepRetryPolicy)) : timedStep;

  return retryableStep.pipe(
    Effect.map((data) => ({
      data,
      status: "succeeded" as const
    })),
    Effect.catchAll((error) =>
      Effect.succeed({
        error: syncErrorMessage(error, "Sync step failed."),
        status: "error" as const
      })
    )
  );
}

function promiseSyncStepEffect<T, E extends SyncPipelineError>(
  task: () => Promise<T>,
  mapError: (error: unknown) => E
): Effect.Effect<T, E, never> {
  return Effect.tryPromise({
    try: task,
    catch: mapError
  });
}

function normalizeEnrichmentLimit(limit: number | undefined): number {
  return typeof limit === "number" && Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 1), 100) : 50;
}

function syncRunStatus(statuses: SyncStepStatus[]): AppSyncRunStatus {
  return statuses.every((status) => status === "succeeded")
    ? "succeeded"
    : statuses.some((status) => status === "succeeded" || status === "partial")
      ? "partial"
      : "error";
}

function syncRunErrorMessage(steps: Array<StepResult<unknown>>): string | undefined {
  const messages = steps.flatMap((step) => (step.error ? [step.error] : []));
  return messages.length > 0 ? messages.join(" | ") : undefined;
}

function normalizeSnapTradeStep(step: StepResult<SnapTradeSyncResult>): StepResult<SnapTradeSyncResult> {
  if (step.status !== "succeeded" || !step.data) {
    return step;
  }

  return snaptradeSyncStepStatus(step.data) === "partial"
    ? {
        ...step,
        status: "partial"
      }
    : step;
}

function normalizeSimpleFinStep(step: StepResult<SimpleFinSyncResult>): StepResult<SimpleFinSyncResult> {
  if (step.status !== "succeeded" || !step.data) {
    return step;
  }

  return simpleFinSyncStepStatus(step.data) === "partial"
    ? {
        ...step,
        status: "partial"
      }
    : simpleFinSyncStepStatus(step.data) === "error"
      ? {
          ...step,
          status: "error"
        }
      : step;
}

function normalizePlaidStep(step: StepResult<PlaidSyncResult>): StepResult<PlaidSyncResult> {
  if (step.status !== "succeeded" || !step.data) {
    return step;
  }

  return plaidSyncStepStatus(step.data) === "partial"
    ? {
        ...step,
        status: "partial"
      }
    : plaidSyncStepStatus(step.data) === "error"
      ? {
          ...step,
          status: "error"
        }
      : step;
}

function snaptradeSyncStepStatus(result: SnapTradeSyncResult): SyncStepStatus {
  if (result.ok || result.errors.length === 0) {
    return "succeeded";
  }

  return result.accountCount > 0 || result.positionCount > 0 || result.connectionCount > 0 ? "partial" : "error";
}

function simpleFinSyncStepStatus(result: SimpleFinSyncResult): SyncStepStatus {
  if (result.ok || result.errors.length === 0) {
    return "succeeded";
  }

  return result.accountCount > 0 || result.transactionCount > 0 || result.connectionCount > 0 ? "partial" : "error";
}

function plaidSyncStepStatus(result: PlaidSyncResult): SyncStepStatus {
  if (result.ok || result.errors.length === 0) {
    return "succeeded";
  }

  return result.accountCount > 0 || result.transactionCount > 0 || result.itemCount > 0 ? "partial" : "error";
}

function summarizeSnapTradeStep(step: StepResult<SnapTradeSyncResult>): Record<string, unknown> {
  if (!step.data) {
    return { error: step.error ?? "SnapTrade sync failed." };
  }

  return summarizeSnapTradeResult(step.data);
}

function summarizeSimpleFinStep(step: StepResult<SimpleFinSyncResult>): Record<string, unknown> {
  if (!step.data) {
    return { error: step.error ?? "SimpleFIN sync failed." };
  }

  return summarizeSimpleFinResult(step.data);
}

function summarizePlaidStep(step: StepResult<PlaidSyncResult>): Record<string, unknown> {
  if (!step.data) {
    return { error: step.error ?? "Plaid sync failed." };
  }

  return summarizePlaidResult(step.data);
}

function summarizeSnapTradeResult(result: SnapTradeSyncResult): Record<string, unknown> {
  return {
    accountCount: result.accountCount,
    configured: result.status.configured,
    connectionCount: result.connectionCount,
    errors: result.errors,
    lastSyncedAt: result.lastSyncedAt,
    positionCount: result.positionCount,
    registered: result.status.registered,
    skipped: !result.status.configured
  };
}

function summarizePlaidResult(result: PlaidSyncResult): Record<string, unknown> {
  return {
    accountCount: result.accountCount,
    configured: result.status.configured,
    cursorCount: result.status.items.filter((item) => item.cursorPresent).length,
    errors: result.errors,
    itemCount: result.itemCount,
    lastSyncedAt: result.lastSyncedAt,
    removedTransactionCount: result.removedTransactionCount,
    skipped: !result.status.configured,
    transactionCount: result.transactionCount
  };
}

function summarizeSimpleFinResult(result: SimpleFinSyncResult): Record<string, unknown> {
  return {
    accountCount: result.accountCount,
    configured: result.status.configured,
    connectionCount: result.connectionCount,
    errors: result.errors,
    lastSyncedAt: result.lastSyncedAt,
    newestPostedAt: result.newestPostedAt,
    requestEndUnix: result.requestEndUnix,
    requestStartUnix: result.requestStartUnix,
    skipped: !result.status.configured,
    transactionCount: result.transactionCount
  };
}

function simpleFinErrorsForMessage(errors: unknown[]): string | undefined {
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

function normalizeSourceStep(step: StepResult<SourceSyncBatchResult>): StepResult<SourceSyncBatchResult> {
  if (step.status !== "succeeded" || !step.data) {
    return step;
  }

  return sourceSyncBatchStepStatus(step.data.summary) === "partial"
    ? {
        ...step,
        status: "partial"
      }
      : step;
}

function normalizeEnrichmentStep(step: StepResult<EnrichmentRunResult>): StepResult<EnrichmentRunResult> {
  if (step.status !== "succeeded" || !step.data) {
    return step;
  }

  return enrichmentRunStepStatus(step.data) === "partial"
    ? {
        ...step,
        status: "partial"
      }
    : step;
}

export function enrichmentRunStepStatus(run: Pick<EnrichmentRunResult, "provider">): SyncStepStatus {
  if (!run.provider.provider.configured) {
    return "succeeded";
  }

  if (!run.provider.completed) {
    return "partial";
  }

  const hostedSuggestionsWereRejected =
    run.provider.suggestionsSeen > 0 &&
    run.provider.suggestionsAccepted === 0 &&
    run.provider.suggestionsRejected > 0;

  return hostedSuggestionsWereRejected ? "partial" : "succeeded";
}

function sourceStepStatus(
  sourceStep: StepResult<SourceSyncBatchResult>,
  evidenceRefreshStep: StepResult<Awaited<ReturnType<typeof refreshSourceEvidenceMatches>>>
): AppSyncRunStatus {
  if (sourceStep.status === "error") {
    return "error";
  }

  return evidenceRefreshStep.status === "error" || sourceStep.status === "partial" ? "partial" : "succeeded";
}

function summarizeSourceStep(
  step: StepResult<SourceSyncBatchResult>,
  evidenceRefreshStep: StepResult<Awaited<ReturnType<typeof refreshSourceEvidenceMatches>>>
): Record<string, unknown> {
  const evidenceRefresh = evidenceRefreshStep.data ?? {
    error: evidenceRefreshStep.error ?? "Source evidence rematch failed."
  };

  if (!step.data) {
    return {
      error: step.error ?? "Evidence source sync failed.",
      evidenceRefresh
    };
  }

  return {
    evidenceRefresh,
    failedSources: step.data.data
      .filter((result) => result.runStatus === "error")
      .map((result) => ({
        displayName: result.adapter.displayName,
        errorMessage: result.errorMessage,
        sourceId: result.sourceId
      })),
    partialSources: step.data.data
      .filter((result) => result.runStatus === "partial")
      .map((result) => ({
        displayName: result.adapter.displayName,
        errorMessage: result.errorMessage,
        sourceId: result.sourceId
      })),
    staleSources: step.data.data
      .filter((result) => result.runStatus === "succeeded" && result.sourceStatus === "stale")
      .map((result) => ({
        displayName: result.adapter.displayName,
        errorMessage: result.errorMessage,
        sourceId: result.sourceId
      })),
    summary: step.data.summary
  };
}

export function sourceSyncBatchStepStatus(
  summary: Pick<SourceSyncBatchResult["summary"], "sourcesErrored" | "sourcesPartial" | "sourcesStale">
): SyncStepStatus {
  return summary.sourcesErrored > 0 || summary.sourcesPartial > 0 || summary.sourcesStale > 0
    ? "partial"
    : "succeeded";
}

function summarizeEnrichmentStep(
  step: StepResult<Awaited<ReturnType<typeof generateEnrichmentSuggestions>>>,
  semanticStep: StepResult<Awaited<ReturnType<typeof refreshSemanticIndexSummary>>>
): Record<string, unknown> {
  if (!step.data) {
    return {
      error: step.error ?? "AI enrichment failed.",
      semanticIndex: semanticStep.data ?? { error: semanticStep.error ?? "Semantic index refresh failed." }
    };
  }

  return {
    generatedAt: step.data.generatedAt,
    pairMatcher: step.data.pairMatcher,
    pendingSuggestions: step.data.pendingSuggestions,
    provider: {
      completed: step.data.provider.completed,
      errorMessage: step.data.provider.errorMessage,
      provider: step.data.provider.provider,
      source: step.data.provider.source,
      suggestionsAccepted: step.data.provider.suggestionsAccepted,
      suggestionsRejected: step.data.provider.suggestionsRejected,
      suggestionsSeen: step.data.provider.suggestionsSeen
    },
    semanticIndex: semanticStep.data,
    suggestionsCreated: step.data.suggestionsCreated,
    suggestionsSeen: step.data.suggestionsSeen
  };
}

async function refreshSemanticIndexSummary() {
  const refresh = await ensureSemanticIndex();
  const summary = await getSemanticDocumentSummary();

  return {
    documentsEmbedded: refresh.documentsEmbedded,
    embeddingDimensions: refresh.activeModel.dims,
    embeddingModel: refresh.activeModel.model,
    embeddingProvider: refresh.activeModel.provider,
    modelChanged: refresh.modelChanged,
    previousModelIds: refresh.previousModelIds,
    sourceItemDocuments: summary.sourceItemDocumentCount,
    sourceItemEmbeddings: summary.sourceItemEmbeddingCount,
    staleDocuments: summary.staleDocumentCount,
    transactionDocuments: summary.transactionDocumentCount,
    transactionEmbeddings: summary.transactionEmbeddingCount
  };
}
