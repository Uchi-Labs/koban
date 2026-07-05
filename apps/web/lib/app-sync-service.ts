import {
  ensureSemanticIndex,
  generateEnrichmentSuggestions,
  getSemanticDocumentSummary,
  recordAppSyncRun,
  refreshSourceEvidenceMatches,
  type AppSyncRunRecord,
  type AppSyncRunStatus,
  type EnrichmentRunResult
} from "@/lib/db/finance-db";
import { runServerEffect } from "@/lib/effect/runtime";
import {
  EnrichmentError,
  EvidenceMatchError,
  SemanticIndexError,
  SourceRefreshError,
  TellerSyncError,
  syncErrorMessage,
  type SyncPipelineError
} from "@/lib/effect/sync-errors";
import { syncSourceAdaptersEffect, type SourceSyncBatchResult } from "@/lib/source-adapters";
import { syncTellerDataEffect, type TellerSyncResult } from "@/lib/teller-server";
import { Effect, Schedule } from "effect";
import type { Duration } from "effect";

export interface AppSyncOptions {
  enrichmentLimit?: number;
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
  return runServerEffect(runAppSyncEffect(options));
}

function runAppSyncEffect(options: AppSyncOptions = {}) {
  return Effect.gen(function* () {
    const startedAt = new Date().toISOString();
    const enrichmentLimit = normalizeEnrichmentLimit(options.enrichmentLimit);
    const tellerResult = normalizeTellerStep(
      yield* runSyncStepEffect(syncTellerDataEffect(), {
        timeout: "2 minutes",
        timeoutError: () => new TellerSyncError({ message: "Teller sync timed out." })
      })
    );
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
    const statuses = [tellerResult.status, sourcesStatus, semanticResult.status, enrichmentResult.status];

    return yield* Effect.tryPromise({
      try: () =>
        recordAppSyncRun({
          enrichmentStatus: enrichmentResult.status,
          enrichmentSummary: summarizeEnrichmentStep(enrichmentResult, semanticResult),
          errorMessage: syncRunErrorMessage([
            tellerResult,
            sourceResult,
            evidenceRefreshResult,
            semanticResult,
            enrichmentResult
          ]),
          finishedAt,
          sourcesStatus,
          sourcesSummary: summarizeSourceStep(sourceResult, evidenceRefreshResult),
          startedAt,
          status: syncRunStatus(statuses),
          tellerStatus: tellerResult.status,
          tellerSummary: summarizeTellerStep(tellerResult)
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

function normalizeTellerStep(step: StepResult<TellerSyncResult>): StepResult<TellerSyncResult> {
  if (step.status !== "succeeded" || !step.data) {
    return step;
  }

  return step.data.ok === false || step.data.errors.length > 0
    ? {
        ...step,
        status: "partial"
      }
    : step;
}

function summarizeTellerStep(step: StepResult<TellerSyncResult>): Record<string, unknown> {
  if (!step.data) {
    return { error: step.error ?? "Teller sync failed." };
  }

  return {
    accountCount: step.data.accountCount,
    enrollmentCount: step.data.enrollmentCount,
    errors: step.data.errors,
    lastSyncedAt: step.data.lastSyncedAt,
    transactionCount: step.data.transactionCount
  };
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
