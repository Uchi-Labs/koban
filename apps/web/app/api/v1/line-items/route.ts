import { NextRequest, NextResponse } from "next/server";
import { queryLineItems } from "@/lib/db/finance-db";
import { isCalendarDate, parseBoundedLimit } from "@/lib/finance-api";
import { lineMatchToApi } from "@/lib/line-items-api";

export const runtime = "nodejs";

const invalid = (message: string) => NextResponse.json({ error: { message, type: "invalid_request_error" } }, { status: 400 });

/**
 * Itemized lines across every receipt, order and invoice whose name contains each word of `q`
 * (word starts), with the total paid. `has_more` means the list was cut at `limit`; the totals
 * still cover every match.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q")?.trim();
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const limit = parseBoundedLimit(params.get("limit"), 50);

  if (!query) {
    return invalid("q is required: the product words to look for.");
  }
  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (value !== undefined && !isCalendarDate(value)) {
      return invalid(`${name} must be a YYYY-MM-DD date.`);
    }
  }
  if (from && to && from > to) {
    return invalid("from must not be after to.");
  }

  const result = await queryLineItems({ from, limit, query, to });

  return NextResponse.json({
    object: "list",
    data: result.matches.map(lineMatchToApi),
    has_more: result.truncated,
    total_paid: result.total,
    currency: result.currency ?? null,
    line_count: result.matchCount,
    unpriced_count: result.unpricedCount,
    source_item_count: result.sourceItemCount
  });
}
