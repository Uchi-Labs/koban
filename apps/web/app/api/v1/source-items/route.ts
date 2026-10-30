import { NextRequest, NextResponse } from "next/server";
import { listSourceItems } from "@/lib/db/finance-db";
import { isCalendarDate, parseBoundedLimit } from "@/lib/finance-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = params.get("q") ?? undefined;
  const sourceId = params.get("source_id") ?? undefined;
  const kind = params.get("kind") ?? undefined;
  const limit = parseBoundedLimit(params.get("limit"), 50);
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const amountParam = params.get("amount");
  const amount = amountParam === null ? undefined : Number(amountParam);

  for (const [name, value] of [["from", from], ["to", to]] as const) {
    if (value !== undefined && !isCalendarDate(value)) {
      return NextResponse.json({ error: { message: `${name} must be a YYYY-MM-DD date.`, type: "invalid_request_error" } }, { status: 400 });
    }
  }

  if (from && to && from > to) {
    return NextResponse.json({ error: { message: "from must not be after to.", type: "invalid_request_error" } }, { status: 400 });
  }

  if (amount !== undefined && (amountParam?.trim() === "" || !Number.isFinite(amount))) {
    return NextResponse.json({ error: { message: "amount must be a number.", type: "invalid_request_error" } }, { status: 400 });
  }

  const items = await listSourceItems({ amount, from, kind, limit, query, sourceId, to });

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
