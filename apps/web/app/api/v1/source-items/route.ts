import { NextRequest, NextResponse } from "next/server";
import { listSourceItems } from "@/lib/db/finance-db";
import { parseBoundedLimit } from "@/lib/finance-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const sourceId = request.nextUrl.searchParams.get("source_id") ?? undefined;
  const limit = parseBoundedLimit(request.nextUrl.searchParams.get("limit"), 50);
  const items = await listSourceItems({ limit, query, sourceId });

  return NextResponse.json({
    object: "list",
    data: items.map((item) => ({
      object: "source_item",
      id: item.id,
      source_id: item.sourceId,
      external_id: item.externalId,
      kind: item.kind,
      occurred_at: item.occurredAt,
      title: item.title,
      summary: item.summary,
      merchant_name: item.merchantName,
      amount: item.amount,
      currency: item.currency
    })),
    has_more: false
  });
}
