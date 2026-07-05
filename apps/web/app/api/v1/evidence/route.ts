import type { TransactionEvidenceLink } from "@ai-finances/schema";
import { NextRequest, NextResponse } from "next/server";
import { parseBoundedLimit } from "@/lib/finance-api";
import { listEvidenceLinks, type EvidenceReviewItem } from "@/lib/db/finance-db";

export const runtime = "nodejs";

const evidenceStatuses = new Set<TransactionEvidenceLink["status"] | "all">([
  "accepted",
  "all",
  "dismissed",
  "suggested"
]);

export async function GET(request: NextRequest) {
  const statusParam = request.nextUrl.searchParams.get("status") ?? "suggested";

  if (!evidenceStatuses.has(statusParam as TransactionEvidenceLink["status"] | "all")) {
    return NextResponse.json({ error: "Valid evidence status is required." }, { status: 400 });
  }

  const data = await listEvidenceLinks({
    limit: parseBoundedLimit(request.nextUrl.searchParams.get("limit"), 50, 200),
    status: statusParam as TransactionEvidenceLink["status"] | "all"
  });

  return NextResponse.json({
    object: "list",
    data: data.map(evidenceReviewItemToApi),
    has_more: false
  });
}

function evidenceReviewItemToApi(item: EvidenceReviewItem) {
  return {
    object: "transaction_evidence",
    transaction_id: item.transactionId,
    transaction: {
      id: item.transaction.id,
      date: item.transaction.date,
      merchant_name: item.transaction.merchantName,
      description: item.transaction.description,
      amount: item.transaction.amount,
      currency: item.transaction.currency,
      category_id: item.transaction.categoryId,
      reviewed: item.transaction.reviewed
    },
    source_item: {
      id: item.sourceItem.id,
      source_id: item.sourceItem.sourceId,
      external_id: item.sourceItem.externalId,
      kind: item.sourceItem.kind,
      occurred_at: item.sourceItem.occurredAt,
      title: item.sourceItem.title,
      summary: item.sourceItem.summary,
      merchant_name: item.sourceItem.merchantName,
      amount: item.sourceItem.amount,
      currency: item.sourceItem.currency
    },
    relationship: item.relationship,
    confidence: item.confidence,
    status: item.status,
    created_at: item.createdAt
  };
}
