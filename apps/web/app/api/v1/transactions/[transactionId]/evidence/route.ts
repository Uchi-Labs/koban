import type { EvidenceRelationship, TransactionEvidenceLink } from "@ai-finances/schema";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { createTransactionEvidenceLink, listTransactionEvidence, type TransactionEvidenceItem } from "@/lib/db/finance-db";
import { linesToApi } from "@/lib/line-items-api";

export const runtime = "nodejs";

const evidenceRelationships = new Set<EvidenceRelationship>([
  "merchant_context",
  "order",
  "receipt",
  "travel_context",
  "user_context"
]);
const evidenceStatuses = new Set<TransactionEvidenceLink["status"]>(["accepted", "dismissed", "suggested"]);

export async function GET(_request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const evidence = await listTransactionEvidence({
    transactionId: decodeURIComponent(transactionId)
  });

  return NextResponse.json({
    object: "list",
    data: evidence.map(evidenceToApi),
    has_more: false
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as {
    confidence?: unknown;
    relationship?: unknown;
    source_item_id?: unknown;
    status?: unknown;
  };

  if (typeof body.source_item_id !== "string" || !body.source_item_id.trim()) {
    return NextResponse.json({ error: "Valid source_item_id is required." }, { status: 400 });
  }

  if (body.relationship !== undefined) {
    if (typeof body.relationship !== "string" || !evidenceRelationships.has(body.relationship as EvidenceRelationship)) {
      return NextResponse.json({ error: "Valid evidence relationship is required." }, { status: 400 });
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !evidenceStatuses.has(body.status as TransactionEvidenceLink["status"])) {
      return NextResponse.json({ error: "Valid evidence status is required." }, { status: 400 });
    }
  }

  const confidence = typeof body.confidence === "number" && Number.isFinite(body.confidence) ? body.confidence : undefined;
  const evidence = await createTransactionEvidenceLink({
    confidence,
    relationship: body.relationship as EvidenceRelationship | undefined,
    sourceItemId: body.source_item_id,
    status: body.status as TransactionEvidenceLink["status"] | undefined,
    transactionId: decodeURIComponent(transactionId)
  });

  if (!evidence) {
    return NextResponse.json({ error: "Transaction or source item not found." }, { status: 404 });
  }

  return NextResponse.json(evidenceToApi(evidence), { status: 201 });
}

function evidenceToApi(item: TransactionEvidenceItem) {
  return {
    object: "transaction_evidence",
    transaction_id: item.transactionId,
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
      currency: item.sourceItem.currency,
      lines: item.sourceItem.lines ? linesToApi(item.sourceItem.lines) : null
    },
    relationship: item.relationship,
    confidence: item.confidence,
    status: item.status,
    created_at: item.createdAt
  };
}
