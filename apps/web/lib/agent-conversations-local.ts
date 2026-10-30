// Public demo chats live in the visitor's browser: every visitor shares one
// demo ledger, so server-side conversations would show one visitor's questions
// to the next. This answers the same /api/v1/conversations requests the panel
// already makes, with the same response shapes, from localStorage (or memory
// when storage is unavailable).

import type {
  AgentConversationDetail,
  AgentConversationListResponse,
  AgentConversationSummary,
  AgentConversationTurnSummary
} from "@/lib/agent-conversations";

const storageKey = "koban:demo-conversations";
const maxConversations = 30;

interface StoredConversation extends AgentConversationSummary {
  turns: AgentConversationTurnSummary[];
}

let memory: StoredConversation[] | null = null;

export function isPublicDemoClient(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-public-demo");
}

export function isConversationRequest(url: string): boolean {
  return url === "/api/v1/conversations" || url.startsWith("/api/v1/conversations/");
}

export async function localConversationRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const [, id, action] = url.replace(/^\/api\/v1\/conversations\/?/, "/").split("/").map(decodeURIComponent);
  const conversations = load();

  if (!id) {
    if (method === "GET") {
      const list: AgentConversationListResponse = { object: "list", data: conversations.map(summary), has_more: false };
      return list as T;
    }
    const now = new Date().toISOString();
    const created: StoredConversation = {
      object: "agent_conversation",
      id: `conv_local_${crypto.randomUUID()}`,
      title: "New chat",
      auto_titled: false,
      created_at: now,
      updated_at: now,
      turns: []
    };
    save([created, ...conversations].slice(0, maxConversations));
    return summary(created) as T;
  }

  const conversation = conversations.find((item) => item.id === id);
  if (!conversation) throw new Error("This chat is no longer available.");

  if (action === "turns" && method === "POST") {
    const body = parseBody(init) as { content?: string; meta?: unknown; role?: "user" | "assistant" };
    const turn: AgentConversationTurnSummary = {
      object: "agent_conversation_turn",
      id: `turn_local_${crypto.randomUUID()}`,
      conversation_id: id,
      role: body.role === "assistant" ? "assistant" : "user",
      content: String(body.content ?? ""),
      meta: body.meta ?? null,
      created_at: new Date().toISOString()
    };
    conversation.turns.push(turn);
    conversation.updated_at = turn.created_at;
    save(conversations);
    return turn as T;
  }

  if (action === "title" && method === "POST") {
    const question = conversation.turns.find((turn) => turn.role === "user")?.content ?? "";
    conversation.title = titleFrom(question);
    conversation.auto_titled = true;
    conversation.updated_at = new Date().toISOString();
    save(conversations);
    return summary(conversation) as T;
  }

  if (method === "PATCH") {
    const body = parseBody(init) as { title?: string };
    if (typeof body.title === "string" && body.title.trim()) conversation.title = body.title.trim();
    conversation.auto_titled = false;
    conversation.updated_at = new Date().toISOString();
    save(conversations);
    return summary(conversation) as T;
  }

  if (method === "DELETE") {
    save(conversations.filter((item) => item.id !== id));
    return { deleted: true, id, object: "agent_conversation" } as T;
  }

  const detail: AgentConversationDetail = { ...summary(conversation), turns: conversation.turns };
  return detail as T;
}

function summary({ turns: _turns, ...rest }: StoredConversation): AgentConversationSummary {
  return rest;
}

// The whole question, capped; the chat list truncates it with an ellipsis.
function titleFrom(question: string) {
  const text = question.replace(/\s+/g, " ").trim().slice(0, 120);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "New chat";
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  try {
    return typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function load(): StoredConversation[] {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    memory = Array.isArray(parsed) ? (parsed as StoredConversation[]) : [];
  } catch {
    memory = [];
  }
  return memory;
}

function save(next: StoredConversation[]) {
  memory = [...next].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(memory));
  } catch {
    // Memory still holds this tab's chats when storage is blocked or full.
  }
}
