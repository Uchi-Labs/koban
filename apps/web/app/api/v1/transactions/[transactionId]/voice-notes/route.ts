import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { createTransactionVoiceNote } from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as { transcript?: unknown };
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";

  if (transcript.length === 0) {
    return NextResponse.json({ error: "Voice note transcript is required." }, { status: 400 });
  }

  const voiceNote = await createTransactionVoiceNote({
    transcript,
    transactionId: decodeURIComponent(transactionId)
  });

  if (!voiceNote) {
    return NextResponse.json({ error: "Unable to create voice note." }, { status: 404 });
  }

  return NextResponse.json({
    object: "voice_note",
    source_item: {
      id: voiceNote.sourceItem.id,
      source_id: voiceNote.sourceItem.sourceId,
      external_id: voiceNote.sourceItem.externalId,
      kind: voiceNote.sourceItem.kind,
      occurred_at: voiceNote.sourceItem.occurredAt,
      title: voiceNote.sourceItem.title,
      summary: voiceNote.sourceItem.summary
    }
  });
}
