import { sourceAdapterDefinitions } from "@/lib/source-adapters";

const sourceAdapterIds = new Set(sourceAdapterDefinitions.map((adapter) => adapter.id));

export type SyncRequestParseResult<T> = { ok: true; value: T } | { error: string; ok: false };

export function parseOptionalSourceIds(value: unknown): SyncRequestParseResult<string[] | undefined> {
  if (value === undefined) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (!Array.isArray(value)) {
    return {
      error: "source_ids must be an array of source adapter ids.",
      ok: false
    };
  }

  if (value.length === 0) {
    return {
      error: "source_ids must include at least one source adapter id when provided.",
      ok: false
    };
  }

  const sourceIds: string[] = [];

  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return {
        error: "source_ids must contain only source adapter ids.",
        ok: false
      };
    }

    const sourceId = item.trim();

    if (!sourceAdapterIds.has(sourceId)) {
      return {
        error: `Unknown source adapter: ${sourceId}.`,
        ok: false
      };
    }

    if (!sourceIds.includes(sourceId)) {
      sourceIds.push(sourceId);
    }
  }

  return {
    ok: true,
    value: sourceIds
  };
}

export function parseOptionalEnrichmentLimit(value: unknown): SyncRequestParseResult<number | undefined> {
  if (value === undefined) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      error: "enrichment_limit must be a finite number.",
      ok: false
    };
  }

  return {
    ok: true,
    value
  };
}
