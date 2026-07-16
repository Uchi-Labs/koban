import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { createTransactionContextNote } from "@/lib/db/finance-db";
import { updateStoredTransactionInDb } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as { body?: unknown };
  const noteBody = typeof body.body === "string" ? body.body.trim() : "";

  if (noteBody.length === 0) {
    return NextResponse.json({ error: "Context note body is required." }, { status: 400 });
  }

  const decodedTransactionId = decodeURIComponent(transactionId);
  const transaction = await updateStoredTransactionInDb(decodedTransactionId, {
    notes: noteBody
  });

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found in the local ledger." }, { status: 404 });
  }

  const contextNote = await createTransactionContextNote({
    body: noteBody,
    transactionId: decodedTransactionId
  });

  if (!contextNote) {
    return NextResponse.json({ error: "Unable to create context note." }, { status: 500 });
  }

  return NextResponse.json({
    object: "context_note",
    transaction,
    source_item: {
      id: contextNote.sourceItem.id,
      source_id: contextNote.sourceItem.sourceId,
      external_id: contextNote.sourceItem.externalId,
      kind: contextNote.sourceItem.kind,
      occurred_at: contextNote.sourceItem.occurredAt,
      title: contextNote.sourceItem.title,
      summary: contextNote.sourceItem.summary
    }
  });
}
