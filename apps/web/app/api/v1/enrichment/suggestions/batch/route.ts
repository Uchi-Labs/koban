import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  type EnrichmentSuggestionBatchItem,
  reviewEnrichmentSuggestionsBatch
} from "@/lib/db/finance-db";
import { suggestionToApi } from "@/lib/enrichment-api";

export const runtime = "nodejs";

const maxBatchSuggestionIds = 200;

type BatchSuggestionAction = "accept" | "dismiss";

export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = validateBatchSuggestionBody(parsed.body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await reviewEnrichmentSuggestionsBatch(validation.value);
  const applied = result.applied.map(batchItemToApi);

  return NextResponse.json({
    object: "list",
    data: applied,
    applied,
    failed: result.failed,
    has_more: false
  });
}

function validateBatchSuggestionBody(body: Record<string, unknown>):
  | {
      ok: true;
      value: {
        action: BatchSuggestionAction;
        suggestionIds: string[];
      };
    }
  | { error: string; ok: false } {
  const action = body.action;
  const suggestionIds = body.suggestion_ids;

  if (action !== "accept" && action !== "dismiss") {
    return { error: "Suggestion batch action must be accept or dismiss.", ok: false };
  }

  if (!Array.isArray(suggestionIds)) {
    return { error: "suggestion_ids must be an array of suggestion ids.", ok: false };
  }

  if (suggestionIds.length === 0) {
    return { error: "suggestion_ids must include at least one suggestion id.", ok: false };
  }

  if (suggestionIds.length > maxBatchSuggestionIds) {
    return { error: `suggestion_ids cannot include more than ${maxBatchSuggestionIds} ids.`, ok: false };
  }

  if (!suggestionIds.every((id) => typeof id === "string" && id.trim().length > 0)) {
    return { error: "suggestion_ids must contain only suggestion ids.", ok: false };
  }

  return {
    ok: true,
    value: {
      action,
      suggestionIds: suggestionIds.map((id) => id.trim())
    }
  };
}

function batchItemToApi(item: EnrichmentSuggestionBatchItem) {
  return {
    id: item.id,
    object: "enrichment_suggestion_batch_item",
    rule: item.rule,
    suggestion: suggestionToApi(item.suggestion, item.transaction),
    transaction: item.transaction
  };
}
