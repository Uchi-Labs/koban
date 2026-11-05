// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isStepCount, streamText, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  claudeConnectionState,
  finishClaudeOAuthLogin,
  isClaudeOAuthToken,
  parseClaudeAuthorizationCode,
  readClaudeCodeCredential,
  resolveClaudeAccessToken,
  saveClaudeSetupToken,
  startClaudeOAuthLogin
} from "@/lib/ai/claude-oauth";
import {
  applyClaudeCodeHeaders,
  claudeCodeSystemPrefix,
  createClaudeOAuthFetch,
  createClaudeSubscriptionLanguageModel,
  toClaudeOAuthToolName
} from "@/lib/ai/claude-subscription";
import { closeFinanceDbForTests } from "@/lib/db/finance-db";

let testDir: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDir) {
    rmSync(testDir, { force: true, recursive: true });
    testDir = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
});

function useTempDb() {
  testDir = mkdtempSync(path.join(tmpdir(), "koban-claude-oauth-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testDir, "db");
}

const env = {
  AI_FINANCES_CLAUDE_CODE_VERSION: "9.9.9",
  AI_FINANCES_CLAUDE_USE_CLAUDE_CODE_LOGIN: "0",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test-token"
};

function sse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 });
}

const usage = { input_tokens: 10, output_tokens: 5 };

function toolUseTurn(name: string) {
  return sse([
    { message: { content: [], id: "msg_1", model: "claude-sonnet-5-5", role: "assistant", stop_reason: null, type: "message", usage }, type: "message_start" },
    { content_block: { id: "toolu_1", input: {}, name, type: "tool_use" }, index: 0, type: "content_block_start" },
    { delta: { partial_json: "{}", type: "input_json_delta" }, index: 0, type: "content_block_delta" },
    { index: 0, type: "content_block_stop" },
    { delta: { stop_reason: "tool_use" }, type: "message_delta", usage },
    { type: "message_stop" }
  ]);
}

function textTurn(text: string) {
  return sse([
    { message: { content: [], id: "msg_2", model: "claude-sonnet-5-5", role: "assistant", stop_reason: null, type: "message", usage }, type: "message_start" },
    { content_block: { text: "", type: "text" }, index: 0, type: "content_block_start" },
    { delta: { text, type: "text_delta" }, index: 0, type: "content_block_delta" },
    { index: 0, type: "content_block_stop" },
    { delta: { stop_reason: "end_turn" }, type: "message_delta", usage },
    { type: "message_stop" }
  ]);
}

describe("Claude subscription on the Messages API", () => {
  it("sends Claude Code's identity and runs the app's tools under their own names", async () => {
    const requests: Array<{ body: Record<string, unknown>; headers: Headers; url: string }> = [];
    const fakeAnthropic: typeof fetch = async (input, init) => {
      requests.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers), url: String(input) });
      return requests.length === 1 ? toolUseTurn("mcp__list_recurring_charges") : textTurn("Netflix is $17.99 a month.");
    };
    let executed = 0;

    const result = streamText({
      allowSystemInMessages: true,
      messages: [
        { content: "You are Koban.", role: "system" },
        { content: "What is our Netflix charge?", role: "user" }
      ],
      model: createClaudeSubscriptionLanguageModel("sonnet", env, fakeAnthropic),
      stopWhen: isStepCount(3),
      tools: {
        list_recurring_charges: tool({
          description: "List recurring charges.",
          execute: async () => {
            executed += 1;
            return { charges: [{ merchant: "Netflix", price: 17.99 }] };
          },
          inputSchema: z.object({})
        })
      }
    });
    const toolCalls: string[] = [];
    for await (const part of result.fullStream) {
      if (part.type === "tool-call") toolCalls.push(part.toolName);
    }

    expect(await result.text).toBe("Netflix is $17.99 a month.");
    expect(executed).toBe(1);
    expect(toolCalls).toEqual(["list_recurring_charges"]);

    const [first, second] = requests;
    expect(first.url).toBe("https://api.anthropic.com/v1/messages");
    expect(first.headers.get("authorization")).toBe("Bearer sk-ant-oat01-test-token");
    expect(first.headers.has("x-api-key")).toBe(false);
    expect(first.headers.get("anthropic-beta")?.split(",")).toEqual(
      expect.arrayContaining(["claude-code-20250219", "oauth-2025-04-20"])
    );
    expect(first.headers.get("user-agent")).toBe("claude-code/9.9.9 (external, cli)");
    expect(first.headers.get("x-app")).toBe("cli");
    expect(first.body.model).toBe("claude-sonnet-5-5");
    const system = first.body.system as Array<{ text: string }>;
    expect(system[0].text).toBe(claudeCodeSystemPrefix);
    expect(system[1].text).toBe("You are Koban.");
    expect((first.body.tools as Array<{ name: string }>).map((entry) => entry.name)).toEqual(["mcp__list_recurring_charges"]);

    // The replayed assistant turn names the tool the way the wire knows it.
    const replayed = (second.body.messages as Array<{ content: unknown; role: string }>)
      .filter((message) => message.role === "assistant")
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((block: { type?: string }) => block.type === "tool_use");
    expect(replayed).toEqual([expect.objectContaining({ name: "mcp__list_recurring_charges" })]);
  });

  it("prefixes tool names once", () => {
    expect(toClaudeOAuthToolName("query_line_items")).toBe("mcp__query_line_items");
    expect(toClaudeOAuthToolName("mcp_search")).toBe("mcp__search");
    expect(toClaudeOAuthToolName("mcp__search")).toBe("mcp__search");
  });

  it("replaces an API key with the bearer token and merges betas", () => {
    const headers = applyClaudeCodeHeaders(
      new Headers({ "anthropic-beta": "files-api-2025-04-14", "user-agent": "ai-sdk/anthropic", "x-api-key": "sk-ant-api-x" }),
      "sk-ant-oat01-a",
      "2.1.0"
    );
    expect(headers.has("x-api-key")).toBe(false);
    expect(headers.get("authorization")).toBe("Bearer sk-ant-oat01-a");
    expect(headers.get("anthropic-beta")).toContain("files-api-2025-04-14");
    expect(headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
    expect(headers.get("user-agent")).toBe("claude-code/2.1.0 (external, cli)");
  });

  it("refreshes once and retries after a 401 on an OAuth login", async () => {
    const seen: string[] = [];
    const calls: Array<boolean | undefined> = [];
    const oauthFetch = createClaudeOAuthFetch(env, {
      baseFetch: async (_input, init) => {
        seen.push(new Headers(init?.headers).get("authorization") ?? "");
        return new Response("{}", { status: seen.length === 1 ? 401 : 200 });
      },
      resolveToken: async (options) => {
        calls.push(options?.forceRefresh);
        return { accessToken: options?.forceRefresh ? "sk-ant-oat01-new" : "sk-ant-oat01-old", source: "oauth_login" };
      }
    });

    const response = await oauthFetch("https://api.anthropic.com/v1/messages", { body: "{}", method: "POST" });

    expect(response.status).toBe(200);
    expect(seen).toEqual(["Bearer sk-ant-oat01-old", "Bearer sk-ant-oat01-new"]);
    expect(calls).toEqual([undefined, true]);
  });

  it("does not retry a 401 for a token it cannot refresh", async () => {
    let sent = 0;
    const oauthFetch = createClaudeOAuthFetch(env, {
      baseFetch: async () => {
        sent += 1;
        return new Response("{}", { status: 401 });
      },
      resolveToken: async () => ({ accessToken: "sk-ant-oat01-setup", source: "setup_token" })
    });

    expect((await oauthFetch("https://api.anthropic.com/v1/messages", { method: "POST" })).status).toBe(401);
    expect(sent).toBe(1);
  });
});

describe("Claude subscription credentials", () => {
  it("accepts subscription tokens and refuses Console API keys", async () => {
    expect(isClaudeOAuthToken("sk-ant-oat01-abc")).toBe(true);
    expect(isClaudeOAuthToken("sk-ant-api03-abc")).toBe(false);
    useTempDb();
    await expect(saveClaudeSetupToken("sk-ant-api03-abc")).rejects.toThrow("claude setup-token");
    await saveClaudeSetupToken("  sk-ant-oat01-setup  ");
    expect(await resolveClaudeAccessToken({ env: {} })).toEqual({ accessToken: "sk-ant-oat01-setup", expiresAt: undefined, source: "setup_token" });
    expect(await claudeConnectionState({})).toMatchObject({ connected: true, source: "setup_token" });
  });

  it("logs in with PKCE, then refreshes an expired token once for concurrent callers", async () => {
    useTempDb();
    const { url } = await startClaudeOAuthLogin();
    const authorize = new URL(url);
    expect(authorize.origin + authorize.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe("https://console.anthropic.com/oauth/code/callback");
    const state = authorize.searchParams.get("state")!;

    await expect(finishClaudeOAuthLogin("code-1#wrong-state", async () => new Response("{}"))).rejects.toThrow("different sign-in");

    const tokenRequests: Array<Record<string, string>> = [];
    await finishClaudeOAuthLogin(`code-1#${state}`, async (_input, init) => {
      tokenRequests.push(JSON.parse(String(init?.body)));
      expect(new Headers(init?.headers).get("user-agent")).toBe("axios/1.7.9");
      return Response.json({ access_token: "sk-ant-oat01-first", expires_in: 3600, refresh_token: "rt-1" });
    });
    expect(tokenRequests[0]).toMatchObject({ code: "code-1", grant_type: "authorization_code", state });
    expect(tokenRequests[0].code_verifier).toMatch(/^[\w-]{43}$/);

    expect((await resolveClaudeAccessToken({ env: {} })).accessToken).toBe("sk-ant-oat01-first");

    let refreshes = 0;
    const refresher: typeof fetch = async (_input, init) => {
      refreshes += 1;
      expect(JSON.parse(String(init?.body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-1" });
      return Response.json({ access_token: "sk-ant-oat01-second", expires_in: 86_400, refresh_token: "rt-2" });
    };
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const [a, b] = await Promise.all([
      resolveClaudeAccessToken({ env: {}, fetcher: refresher, now: later }),
      resolveClaudeAccessToken({ env: {}, fetcher: refresher, now: later })
    ]);

    expect(a.accessToken).toBe("sk-ant-oat01-second");
    expect(b.accessToken).toBe("sk-ant-oat01-second");
    expect(refreshes).toBe(1);
    // The rotated refresh token was stored: the next resolve needs no network.
    expect((await resolveClaudeAccessToken({ env: {}, fetcher: refresher, now: later })).accessToken).toBe("sk-ant-oat01-second");
    expect(refreshes).toBe(1);
  });

  it("reports a rejected refresh instead of using the expired token", async () => {
    useTempDb();
    const { url } = await startClaudeOAuthLogin();
    const state = new URL(url).searchParams.get("state")!;
    await finishClaudeOAuthLogin(`c#${state}`, async () => Response.json({ access_token: "sk-ant-oat01-x", expires_in: 60, refresh_token: "rt-dead" }));

    let posts = 0;
    await expect(
      resolveClaudeAccessToken({
        env: {},
        fetcher: async () => {
          posts += 1;
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
      })
    ).rejects.toThrow("invalid_grant");
    // A dead grant is not replayed against the fallback host.
    expect(posts).toBe(1);
  });

  it("splits the code#state string Claude shows", () => {
    expect(parseClaudeAuthorizationCode(" abc#xyz \n")).toEqual({ code: "abc", state: "xyz" });
    expect(parseClaudeAuthorizationCode("abc")).toEqual({ code: "abc", state: "" });
  });

  it("borrows Claude Code's login read-only and reports it expired", async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "koban-claude-code-"));
    const file = path.join(testDir, ".credentials.json");
    writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-cc", expiresAt: 1_000, refreshToken: "rt" } }));
    expect(readClaudeCodeCredential(file)).toEqual({ accessToken: "sk-ant-oat01-cc", expiresAt: 1_000, source: "claude_code" });
    writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-api03-key" } }));
    expect(readClaudeCodeCredential(file)).toBeNull();
  });
});
