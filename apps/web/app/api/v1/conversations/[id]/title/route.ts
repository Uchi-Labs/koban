import { NextResponse } from "next/server";
import { readOptionalJsonObject } from "@/lib/api-request";
import { serializeAgentConversation } from "@/lib/agent-conversations";
import { generateAgentConversationTitle } from "@/lib/agent-conversation-title";
import {
  defaultAgentConversationTitle,
  getAgentConversationWithTurns,
  setAgentConversationGeneratedTitle
} from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const conversationId = decodeURIComponent(id);
  const conversation = await getAgentConversationWithTurns(conversationId);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (conversation.title !== defaultAgentConversationTitle) {
    return NextResponse.json(serializeAgentConversation(conversation));
  }

  const generated = await generateAgentConversationTitle(conversation.turns);
  const updated = await setAgentConversationGeneratedTitle(
    conversationId,
    generated.title,
    generated.autoTitled
  );

  if (!updated) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json(serializeAgentConversation(updated));
}
