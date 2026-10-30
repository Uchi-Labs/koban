import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { isCalendarDate } from "@/lib/finance-api";
import { searchSourceLive } from "@/lib/source-adapters";

export const runtime = "nodejs";

const maxWindowDays = 31;

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { from, limit, q, to } = parsed.body as { from?: unknown; limit?: unknown; q?: unknown; to?: unknown };

  if (typeof from !== "string" || !isCalendarDate(from) || typeof to !== "string" || !isCalendarDate(to)) {
    return invalid("from and to are required YYYY-MM-DD dates.");
  }

  const windowDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;

  if (windowDays < 0 || windowDays > maxWindowDays) {
    return invalid(`from must be on or before to, within ${maxWindowDays} days.`);
  }

  if (q !== undefined && (typeof q !== "string" || q.length > 200)) {
    return invalid("q must be a string of at most 200 characters.");
  }

  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50)) {
    return invalid("limit must be an integer from 1 to 50.");
  }

  try {
    const result = await searchSourceLive(decodeURIComponent(sourceId), { from, limit, query: q, to });
    return NextResponse.json({
      object: "source_search",
      source_id: result.sourceId,
      items_written: result.run.itemsWritten,
      evidence_links_suggested: result.run.evidenceLinksSuggested,
      data: result.items.map((item) => ({
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
      }))
    });
  } catch (error) {
    return errorResponse(error, "Unable to search the source.", 400);
  }
}

function invalid(message: string) {
  return NextResponse.json({ error: { message, type: "invalid_request_error" } }, { status: 400 });
}
