import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  applyEnrichmentSuggestion,
  dismissEnrichmentSuggestion
} from "@/lib/db/finance-db";
import { suggestionToApi } from "@/lib/enrichment-api";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ suggestionId: string }> }) {
  const { suggestionId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as { status?: unknown };
  const decodedSuggestionId = decodeURIComponent(suggestionId);

  if (body.status === "applied") {
    const result = await applyEnrichmentSuggestion(decodedSuggestionId);

    if (!result) {
      return NextResponse.json({ error: "Suggestion not found or already resolved." }, { status: 404 });
    }

    return NextResponse.json({
      object: "enrichment_suggestion_apply_result",
      suggestion: suggestionToApi(result.suggestion, result.transaction),
      transaction: result.transaction,
      rule: result.rule
    });
  }

  if (body.status === "dismissed") {
    const suggestion = await dismissEnrichmentSuggestion(decodedSuggestionId);

    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found or already resolved." }, { status: 404 });
    }

    return NextResponse.json({
      object: "enrichment_suggestion",
      suggestion: suggestionToApi(suggestion)
    });
  }

  return NextResponse.json({ error: "Suggestion status must be applied or dismissed." }, { status: 400 });
}
