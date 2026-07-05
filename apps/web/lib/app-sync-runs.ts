import type { AppSyncRunRecord, AppSyncRunStatus, SyncScheduleRecord } from "@/lib/db/finance-db";

export interface AppSyncStepPayload<TSummary extends Record<string, unknown> = Record<string, unknown>> {
  data?: TSummary;
  error?: string;
  status: AppSyncRunStatus;
}

export interface TellerSyncSummaryPayload extends Record<string, unknown> {
  accountCount?: number;
  enrollmentCount?: number;
  errors?: string[];
  lastSyncedAt?: string;
  transactionCount?: number;
}

export interface SourceSyncSummaryPayload extends Record<string, unknown> {
  evidenceRefresh?: {
    error?: string;
    evidenceLinksSuggested?: number;
    sourceItemCount?: number;
  };
  failedSources?: Array<{
    displayName?: string;
    errorMessage?: string;
    sourceId: string;
  }>;
  staleSources?: Array<{
    displayName?: string;
    errorMessage?: string;
    sourceId: string;
  }>;
  summary?: {
    evidenceLinksSuggested?: number;
    itemsWritten?: number;
    sourcesAttempted?: number;
    sourcesErrored?: number;
    sourcesStale?: number;
  };
}

export interface EnrichmentSyncSummaryPayload extends Record<string, unknown> {
  generatedAt?: string;
  pendingSuggestions?: number;
  provider?: Record<string, unknown>;
  semanticIndex?: {
    documentsEmbedded?: number;
    embeddingDimensions?: number;
    embeddingModel?: string;
    embeddingProvider?: string;
    error?: string;
    modelChanged?: boolean;
    previousModelIds?: string[];
    sourceItemDocuments?: number;
    sourceItemEmbeddings?: number;
    staleDocuments?: number;
    transactionDocuments?: number;
    transactionEmbeddings?: number;
  };
  suggestionsCreated?: number;
  suggestionsSeen?: number;
}

export interface AppSyncRunPayload {
  enrichment: AppSyncStepPayload<EnrichmentSyncSummaryPayload>;
  error?: string;
  finished_at: string;
  id: string;
  object: "app_sync_run";
  sources: AppSyncStepPayload<SourceSyncSummaryPayload>;
  started_at: string;
  status: AppSyncRunStatus;
  teller: AppSyncStepPayload<TellerSyncSummaryPayload>;
}

export interface SyncSchedulePayload {
  due: boolean;
  enabled: boolean;
  id: string;
  interval_minutes: number;
  last_error_message?: string;
  last_finished_at?: string;
  last_run_id?: string;
  last_started_at?: string;
  last_status?: AppSyncRunStatus;
  next_run_at?: string;
  object: "sync_schedule";
  updated_at: string;
}

export function appSyncRunRecordToPayload(record: AppSyncRunRecord): AppSyncRunPayload {
  return {
    enrichment: stepPayload(record.enrichmentStatus, record.enrichmentSummary),
    error: record.errorMessage,
    finished_at: record.finishedAt,
    id: record.id,
    object: "app_sync_run",
    sources: stepPayload(record.sourcesStatus, record.sourcesSummary),
    started_at: record.startedAt,
    status: record.status,
    teller: stepPayload(record.tellerStatus, record.tellerSummary)
  };
}

export function syncScheduleRecordToPayload(record: SyncScheduleRecord): SyncSchedulePayload {
  return {
    due: record.enabled && isDue(record.nextRunAt),
    enabled: record.enabled,
    id: record.id,
    interval_minutes: record.intervalMinutes,
    last_error_message: record.lastErrorMessage,
    last_finished_at: record.lastFinishedAt,
    last_run_id: record.lastRunId,
    last_started_at: record.lastStartedAt,
    last_status: record.lastStatus,
    next_run_at: record.nextRunAt,
    object: "sync_schedule",
    updated_at: record.updatedAt
  };
}

function stepPayload<TSummary extends Record<string, unknown>>(
  status: AppSyncRunStatus,
  summary: TSummary
): AppSyncStepPayload<TSummary> {
  const error = typeof summary.error === "string" ? summary.error : undefined;

  return error && status === "error"
    ? {
        error,
        status
      }
    : {
        data: summary,
        status
      };
}

function isDue(nextRunAt: string | undefined): boolean {
  return nextRunAt !== undefined && Date.parse(nextRunAt) <= Date.now();
}
