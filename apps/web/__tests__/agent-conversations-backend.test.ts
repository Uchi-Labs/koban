// @vitest-environment node

import type { AgentConversationTurn } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST as createConversationRoute } from "@/app/api/v1/conversations/route";
import {
  PATCH as renameConversationRoute
} from "@/app/api/v1/conversations/[id]/route";
import { POST as appendTurnRoute } from "@/app/api/v1/conversations/[id]/turns/route";
import { POST as titleConversationRoute } from "@/app/api/v1/conversations/[id]/title/route";
import {
  fallbackAgentConversationTitle,
  generateAgentConversationTitle
} from "@/lib/agent-conversation-title";
import {
  appendAgentConversationTurn,
  closeFinanceDbForTests,
  createAgentConversation,
  deleteAgentConversation,
  getAgentConversationWithTurns,
  listAgentConversations,
  listAgentConversationTurns,
  renameAgentConversation,
  setAgentConversationGeneratedTitle
} from "@/lib/db/finance-db";

let testRoot: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();

  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = null;
  }

  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_LLM_API_KEY;
  delete process.env.AI_FINANCES_LLM_BASE_URL;
  delete process.env.AI_FINANCES_LLM_MODEL;
  delete process.env.AI_FINANCES_LLM_PROVIDER;
  delete process.env.AI_FINANCES_LLM_REASONING_MODEL;
  delete process.env.AI_FINANCES_LLM_SIMPLE_MODEL;
  delete process.env.AI_FINANCES_ENABLE_CHATGPT_OAUTH;
  delete process.env.CHATGPT_OAUTH_TOKENS_B64;
  delete process.env.OPENAI_API_KEY;
});

describe("agent conversation persistence", () => {
  it("round-trips CRUD, moves appended conversations first, preserves meta, and protects manual titles", async () => {
    useTempDb();
    const first = await createAgentConversation();
    const second = await createAgentConversation({ title: "Second chat" });

    const userTurn = await appendAgentConversationTurn(first.id, {
      content: "Why did dining spending jump in June?",
      meta: { evidence_ids: ["txn_1"] },
      role: "user"
    });
    const assistantTurn = await appendAgentConversationTurn(first.id, {
      content: "Dining was higher because of three restaurant visits.",
      meta: { chart: { type: "bar" } },
      role: "assistant"
    });

    expect(userTurn?.conversationId).toBe(first.id);
    expect(assistantTurn?.conversationId).toBe(first.id);
    expect((await listAgentConversations()).map((conversation) => conversation.id)).toEqual([
      first.id,
      second.id
    ]);

    const detail = await getAgentConversationWithTurns(first.id);
    expect(detail?.turns).toMatchObject([
      {
        content: "Why did dining spending jump in June?",
        meta: { evidence_ids: ["txn_1"] },
        role: "user"
      },
      {
        content: "Dining was higher because of three restaurant visits.",
        meta: { chart: { type: "bar" } },
        role: "assistant"
      }
    ]);

    const generatedTitle = await setAgentConversationGeneratedTitle(first.id, "June Dining", true);
    const repeatedGeneratedTitle = await setAgentConversationGeneratedTitle(first.id, "Changed Again", true);
    expect(generatedTitle).toMatchObject({ autoTitled: true, title: "June Dining" });
    expect(repeatedGeneratedTitle).toMatchObject({ autoTitled: true, title: "June Dining" });
    const repeatedTitleResponse = await titleConversationRoute(
      new Request(`http://localhost/api/v1/conversations/${first.id}/title`, { method: "POST" }),
      routeContext(first.id)
    );
    await expect(repeatedTitleResponse.json()).resolves.toMatchObject({
      auto_titled: true,
      title: "June Dining"
    });

    const renamed = await renameAgentConversation(first.id, "June Dining Review");
    expect(renamed).toMatchObject({ autoTitled: false, title: "June Dining Review" });

    const titleResponse = await titleConversationRoute(
      new Request(`http://localhost/api/v1/conversations/${first.id}/title`, { method: "POST" }),
      routeContext(first.id)
    );
    await expect(titleResponse.json()).resolves.toMatchObject({
      auto_titled: false,
      title: "June Dining Review"
    });

    await expect(deleteAgentConversation(first.id)).resolves.toBe(true);
    await expect(getAgentConversationWithTurns(first.id)).resolves.toBeNull();
    await expect(listAgentConversationTurns(first.id)).resolves.toEqual([]);
  }, 20_000);
});

describe("agent conversation routes", () => {
  it("returns deliberate 400s for malformed create, rename, and turn bodies", async () => {
    useTempDb();
    const conversation = await createAgentConversation();

    const createResponse = await createConversationRoute(rawRequest(
      "http://localhost/api/v1/conversations",
      "POST",
      "{not-json"
    ));
    const renameResponse = await renameConversationRoute(
      rawRequest(`http://localhost/api/v1/conversations/${conversation.id}`, "PATCH", "[]"),
      routeContext(conversation.id)
    );
    const turnResponse = await appendTurnRoute(
      jsonRequest(`http://localhost/api/v1/conversations/${conversation.id}/turns`, "POST", {
        content: "",
        role: "tool"
      }),
      routeContext(conversation.id)
    );
    const titleResponse = await titleConversationRoute(
      rawRequest(`http://localhost/api/v1/conversations/${conversation.id}/title`, "POST", "{not-json"),
      routeContext(conversation.id)
    );

    expect(createResponse.status).toBe(400);
    expect(renameResponse.status).toBe(400);
    expect(turnResponse.status).toBe(400);
    expect(titleResponse.status).toBe(400);
    await expect(createResponse.json()).resolves.toEqual({ error: "Request body must be valid JSON." });
    await expect(renameResponse.json()).resolves.toEqual({ error: "Request body must be a JSON object." });
    await expect(turnResponse.json()).resolves.toEqual({ error: "Turn role must be 'user' or 'assistant'." });
    await expect(titleResponse.json()).resolves.toEqual({ error: "Request body must be valid JSON." });
  });
});

describe("agent conversation titles", () => {
  it("falls back to the first user question at 32 characters when no AI provider is configured", async () => {
    useTempDb();
    const question = "Why did restaurant spending jump in June?";
    const result = await generateAgentConversationTitle([
      turn("user", question),
      turn("assistant", "Three larger dinners explain the increase.")
    ]);

    expect(result).toEqual({
      autoTitled: false,
      title: fallbackAgentConversationTitle(question)
    });
    expect(result.title).toHaveLength(32);
  });
});

function useTempDb() {
  testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-conversations-"));
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testRoot, "pglite");
}

function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function rawRequest(url: string, method: string, body: string): Request {
  return new Request(url, {
    body,
    headers: { "Content-Type": "application/json" },
    method
  });
}

function jsonRequest(url: string, method: string, body: Record<string, unknown>): Request {
  return rawRequest(url, method, JSON.stringify(body));
}

function turn(role: AgentConversationTurn["role"], content: string): AgentConversationTurn {
  return {
    content,
    conversationId: "conv_test",
    createdAt: "2026-07-17T00:00:00.000Z",
    id: `turn_${role}`,
    role
  };
}
