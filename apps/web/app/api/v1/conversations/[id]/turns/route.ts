import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  parseAgentConversationTurnBody,
  serializeAgentConversationTurn
} from "@/lib/agent-conversations";
import { appendAgentConversationTurn } from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = parseAgentConversationTurnBody(parsed.body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const turn = await appendAgentConversationTurn(decodeURIComponent(id), validation.value);

  if (!turn) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json(serializeAgentConversationTurn(turn), { status: 201 });
}
