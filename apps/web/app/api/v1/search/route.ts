import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { semanticSearchFinanceResources } from "@/lib/db/finance-db";
import { parseBoundedLimit } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = parseBoundedLimit(request.nextUrl.searchParams.get("limit"), 12, 50);
  return search(query, limit);
}

export async function POST(request: NextRequest) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as { limit?: unknown; query?: unknown };
  const query = typeof body.query === "string" ? body.query : "";
  const limit = parseBoundedLimit(body.limit, 12, 50);
  return search(query, limit);
}

async function search(query: string, limit: number) {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    return NextResponse.json({ object: "list", data: [], has_more: false });
  }

  await getFinanceData();
  const results = await semanticSearchFinanceResources(trimmedQuery, limit);

  return NextResponse.json({
    object: "list",
    data: results.map((result) => ({
      object: "search_result",
      resource_type: result.resourceType,
      resource_id: result.resourceId,
      title: result.title,
      score: result.score,
      distance: result.distance,
      body: result.body,
      source_item: result.sourceItem,
      transaction: result.transaction
    })),
    has_more: false
  });
}
