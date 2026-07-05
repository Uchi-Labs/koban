import type { EvidenceRelationship, TransactionEvidenceLink } from "@ai-finances/schema";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { updateTransactionEvidenceStatus } from "@/lib/db/finance-db";

export const runtime = "nodejs";

const evidenceRelationships = new Set<EvidenceRelationship>([
  "merchant_context",
  "order",
  "receipt",
  "travel_context",
  "user_context"
]);
const evidenceStatuses = new Set<TransactionEvidenceLink["status"]>(["accepted", "dismissed", "suggested"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sourceItemId: string; transactionId: string }> }
) {
  const { sourceItemId, transactionId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as {
    relationship?: unknown;
    status?: unknown;
  };

  if (typeof body.relationship !== "string" || !evidenceRelationships.has(body.relationship as EvidenceRelationship)) {
    return NextResponse.json({ error: "Valid evidence relationship is required." }, { status: 400 });
  }

  if (typeof body.status !== "string" || !evidenceStatuses.has(body.status as TransactionEvidenceLink["status"])) {
    return NextResponse.json({ error: "Valid evidence status is required." }, { status: 400 });
  }

  const evidence = await updateTransactionEvidenceStatus({
    relationship: body.relationship as EvidenceRelationship,
    sourceItemId: decodeURIComponent(sourceItemId),
    status: body.status as TransactionEvidenceLink["status"],
    transactionId: decodeURIComponent(transactionId)
  });

  if (!evidence) {
    return NextResponse.json({ error: "Evidence link not found." }, { status: 404 });
  }

  return NextResponse.json({
    object: "transaction_evidence",
    transaction_id: evidence.transactionId,
    source_item: {
      id: evidence.sourceItem.id,
      source_id: evidence.sourceItem.sourceId,
      external_id: evidence.sourceItem.externalId,
      kind: evidence.sourceItem.kind,
      occurred_at: evidence.sourceItem.occurredAt,
      title: evidence.sourceItem.title,
      summary: evidence.sourceItem.summary,
      merchant_name: evidence.sourceItem.merchantName,
      amount: evidence.sourceItem.amount,
      currency: evidence.sourceItem.currency
    },
    relationship: evidence.relationship,
    confidence: evidence.confidence,
    status: evidence.status,
    created_at: evidence.createdAt
  });
}
