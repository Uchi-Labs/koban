import type { AgentConversation, AgentConversationTurn } from "@ai-finances/schema";
import { isSameDay, isValid, startOfDay, startOfWeek, subDays } from "date-fns";
import type { JsonObject } from "@/lib/api-request";
import type { AgentConversationTurnCreateInput } from "@/lib/db/finance-db";

const maxTitleLength = 120;

export interface AgentConversationSummary {
  object: "agent_conversation";
  id: string;
  title: string;
  auto_titled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentConversationTurnSummary {
  object: "agent_conversation_turn";
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  meta: unknown | null;
  created_at: string;
}

export interface AgentConversationDetail extends AgentConversationSummary {
  turns: AgentConversationTurnSummary[];
}

export interface AgentConversationListResponse {
  object: "list";
  data: AgentConversationSummary[];
  has_more: boolean;
}

export type AgentConversationDateGroupLabel = "Today" | "Yesterday" | "This week" | "Older";

export interface AgentConversationDateGroup {
  label: AgentConversationDateGroupLabel;
  conversations: AgentConversationSummary[];
}

const agentConversationDateGroupLabels: AgentConversationDateGroupLabel[] = [
  "Today",
  "Yesterday",
  "This week",
  "Older"
];

export function serializeAgentConversation(conversation: AgentConversation): AgentConversationSummary {
  return {
    object: "agent_conversation",
    id: conversation.id,
    title: conversation.title,
    auto_titled: conversation.autoTitled,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt
  };
}

export function serializeAgentConversationTurn(turn: AgentConversationTurn): AgentConversationTurnSummary {
  return {
    object: "agent_conversation_turn",
    id: turn.id,
    conversation_id: turn.conversationId,
    role: turn.role,
    content: turn.content,
    meta: turn.meta ?? null,
    created_at: turn.createdAt
  };
}

export function groupAgentConversationsByDate(
  conversations: AgentConversationSummary[],
  now = new Date()
): AgentConversationDateGroup[] {
  const today = startOfDay(now);
  const yesterday = subDays(today, 1);
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const buckets: Record<AgentConversationDateGroupLabel, AgentConversationSummary[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    Older: []
  };

  const sortedConversations = [...conversations].sort(compareAgentConversationRecency);

  for (const conversation of sortedConversations) {
    const updatedAt = new Date(conversation.updated_at);
    let label: AgentConversationDateGroupLabel = "Older";

    if (isValid(updatedAt)) {
      if (isSameDay(updatedAt, today)) {
        label = "Today";
      } else if (isSameDay(updatedAt, yesterday)) {
        label = "Yesterday";
      } else if (updatedAt >= thisWeekStart && updatedAt < today) {
        label = "This week";
      }
    }

    buckets[label].push(conversation);
  }

  return agentConversationDateGroupLabels
    .map((label) => ({ conversations: buckets[label], label }))
    .filter((group) => group.conversations.length > 0);
}

function compareAgentConversationRecency(
  left: AgentConversationSummary,
  right: AgentConversationSummary
): number {
  const leftTimestamp = new Date(left.updated_at).getTime();
  const rightTimestamp = new Date(right.updated_at).getTime();
  const leftValid = Number.isFinite(leftTimestamp);
  const rightValid = Number.isFinite(rightTimestamp);

  if (leftValid && rightValid && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }

  return right.id.localeCompare(left.id);
}

export function parseAgentConversationCreateBody(body: JsonObject):
  | { ok: true; value: { title?: string } }
  | { error: string; ok: false } {
  if (body.title === undefined) {
    return { ok: true, value: {} };
  }

  const title = parseTitle(body.title);
  return title.ok ? { ok: true, value: { title: title.value } } : title;
}

export function parseAgentConversationRenameBody(body: JsonObject):
  | { ok: true; value: { title: string } }
  | { error: string; ok: false } {
  const title = parseTitle(body.title);

  if (!title.ok) {
    return title;
  }

  return { ok: true, value: { title: title.value } };
}

export function parseAgentConversationTurnBody(body: JsonObject):
  | { ok: true; value: AgentConversationTurnCreateInput }
  | { error: string; ok: false } {
  if (body.role !== "user" && body.role !== "assistant") {
    return { error: "Turn role must be 'user' or 'assistant'.", ok: false };
  }

  if (typeof body.content !== "string" || !body.content.trim()) {
    return { error: "Turn content must be a non-empty string.", ok: false };
  }

  return {
    ok: true,
    value: {
      content: body.content.trim(),
      meta: body.meta,
      role: body.role
    }
  };
}

function parseTitle(value: unknown):
  | { ok: true; value: string }
  | { error: string; ok: false } {
  if (typeof value !== "string" || !value.trim()) {
    return { error: "Conversation title must be a non-empty string.", ok: false };
  }

  const title = value.trim().replace(/\s+/g, " ");

  if (title.length > maxTitleLength) {
    return { error: `Conversation title cannot exceed ${maxTitleLength} characters.`, ok: false };
  }

  return { ok: true, value: title };
}
