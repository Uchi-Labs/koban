import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  parseAgentConversationRenameBody,
  serializeAgentConversation,
  serializeAgentConversationTurn
} from "@/lib/agent-conversations";
import {
  deleteAgentConversation,
  getAgentConversationWithTurns,
  renameAgentConversation
} from "@/lib/db/finance-db";

export const runtime = "nodejs";

interface ConversationRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: ConversationRouteContext) {
  const { id } = await params;
  const conversation = await getAgentConversationWithTurns(decodeURIComponent(id));

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({
    ...serializeAgentConversation(conversation),
    turns: conversation.turns.map(serializeAgentConversationTurn)
  });
}

export async function PATCH(request: Request, { params }: ConversationRouteContext) {
  const { id } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = parseAgentConversationRenameBody(parsed.body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const conversation = await renameAgentConversation(decodeURIComponent(id), validation.value.title);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json(serializeAgentConversation(conversation));
}

export async function DELETE(_request: Request, { params }: ConversationRouteContext) {
  const { id } = await params;
  const conversationId = decodeURIComponent(id);
  const deleted = await deleteAgentConversation(conversationId);

  if (!deleted) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({
    object: "agent_conversation",
    id: conversationId,
    deleted: true
  });
}
