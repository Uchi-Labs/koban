import { NextResponse } from "next/server";
import { listTransactionLineItems } from "@/lib/db/finance-db";
import { lineToApi, sourceItemRefToApi } from "@/lib/line-items-api";

export const runtime = "nodejs";

/** The itemized receipts and orders behind one transaction, through its trusted evidence links. */
export async function GET(_request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const groups = await listTransactionLineItems(decodeURIComponent(transactionId));

  return NextResponse.json({
    object: "list",
    data: groups.map((group) => ({
      object: "itemized_source",
      source_item: sourceItemRefToApi(group.sourceItem),
      lines: group.lines.map(lineToApi)
    })),
    has_more: false
  });
}
