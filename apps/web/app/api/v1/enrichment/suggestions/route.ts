import type { EnrichmentSuggestionStatus } from "@ai-finances/schema";
import { NextResponse } from "next/server";
import { listEnrichmentSuggestionItems } from "@/lib/db/finance-db";
import { suggestionToApi } from "@/lib/enrichment-api";
import { parseBoundedLimit } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

const statuses = new Set<EnrichmentSuggestionStatus | "all">(["all", "applied", "dismissed", "pending"]);

export async function GET(request: Request) {
  await getFinanceData();
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") ?? "pending";
  const status = statuses.has(statusParam as EnrichmentSuggestionStatus | "all")
    ? statusParam as EnrichmentSuggestionStatus | "all"
    : "pending";
  const limit = parseBoundedLimit(url.searchParams.get("limit"), 50);
  const suggestions = await listEnrichmentSuggestionItems({ limit, status });

  return NextResponse.json({
    object: "list",
    data: suggestions.map((item) => suggestionToApi(item.suggestion, item.transaction)),
    has_more: false
  });
}
