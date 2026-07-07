import { Data } from "effect";

export class TellerSyncError extends Data.TaggedError("TellerSyncError")<{
  cause?: unknown;
  message: string;
}> {}

export class SnapTradeSyncError extends Data.TaggedError("SnapTradeSyncError")<{
  cause?: unknown;
  message: string;
}> {}

export class SimpleFinSyncError extends Data.TaggedError("SimpleFinSyncError")<{
  cause?: unknown;
  message: string;
}> {}

export class PlaidSyncError extends Data.TaggedError("PlaidSyncError")<{
  cause?: unknown;
  message: string;
}> {}

export class SourceRefreshError extends Data.TaggedError("SourceRefreshError")<{
  cause?: unknown;
  message: string;
}> {}

export class EvidenceMatchError extends Data.TaggedError("EvidenceMatchError")<{
  cause?: unknown;
  message: string;
}> {}

export class SemanticIndexError extends Data.TaggedError("SemanticIndexError")<{
  cause?: unknown;
  message: string;
}> {}

export class EnrichmentError extends Data.TaggedError("EnrichmentError")<{
  cause?: unknown;
  message: string;
}> {}

export type SyncPipelineError =
  | TellerSyncError
  | SnapTradeSyncError
  | SimpleFinSyncError
  | PlaidSyncError
  | SourceRefreshError
  | EvidenceMatchError
  | SemanticIndexError
  | EnrichmentError;

export function syncErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
