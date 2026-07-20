import { NextResponse } from "next/server";
import { readOptionalJsonObject } from "@/lib/api-request";
import {
  parseAgentConversationCreateBody,
  serializeAgentConversation
} from "@/lib/agent-conversations";
import {
  createAgentConversation,
  listAgentConversations
} from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function GET() {
  const conversations = await listAgentConversations();

  return NextResponse.json({
    object: "list",
    data: conversations.map(serializeAgentConversation),
    has_more: false
  });
}

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = parseAgentConversationCreateBody(parsed.body);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const conversation = await createAgentConversation(validation.value);
  return NextResponse.json(serializeAgentConversation(conversation), { status: 201 });
}
