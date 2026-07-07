// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chatGptOAuthTokensStateKey,
  chatGptOAuthTokenUrl,
  encodeChatGptOAuthTokens,
  getFreshChatGptOAuthAccessToken,
  getStoredChatGptOAuthTokens,
  parseChatGptOAuthTokens,
  saveChatGptOAuthTokens,
  clearChatGptOAuthTokens,
  type ChatGptOAuthTokens
} from "@/lib/ai/chatgpt-oauth";
import { closeFinanceDbForTests, readSyncStateValue } from "@/lib/db/finance-db";

let testRoot: string | undefined;

afterEach(async () => {
  await closeFinanceDbForTests();
  delete process.env.AI_FINANCES_PGLITE_DIR;

  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = undefined;
  }
});

describe("chatgpt oauth", () => {
  it("returns saved access tokens without live refresh while they are fresh", async () => {
    const tokens: ChatGptOAuthTokens = {
      access: jwtWithExpiry(Date.now() + 60 * 60 * 1000),
      expiry: Date.now() + 60 * 60 * 1000,
      refresh: "test-refresh-token"
    };
    const accessToken = await getFreshChatGptOAuthAccessToken(
      {
        AI_FINANCES_ENABLE_CHATGPT_OAUTH: "1"
      },
      async () => {
        throw new Error("refresh should not be called");
      },
      async () => {
        throw new Error("fresh tokens should not be persisted");
      },
      async () => tokens
    );

    expect(accessToken).toBe(tokens.access);
  });

  it("persists saved tokens in sync_state", async () => {
    useTempFinanceDb();
    const tokens: ChatGptOAuthTokens = {
      access: jwtWithExpiry(Date.now() + 60 * 60 * 1000),
      expiry: Date.now() + 60 * 60 * 1000,
      refresh: "test-refresh-token"
    };

    await saveChatGptOAuthTokens(tokens);

    expect(parseChatGptOAuthTokens(await readSyncStateValue(chatGptOAuthTokensStateKey))).toEqual(tokens);
    await expect(getStoredChatGptOAuthTokens({})).resolves.toEqual(tokens);

    await clearChatGptOAuthTokens();

    await expect(getStoredChatGptOAuthTokens({})).resolves.toBeUndefined();
  }, 15_000);

  it("seeds tokens from env once before using sync_state as source of truth", async () => {
    useTempFinanceDb();
    const tokens: ChatGptOAuthTokens = {
      access: jwtWithExpiry(Date.now() + 60 * 60 * 1000),
      expiry: Date.now() + 60 * 60 * 1000,
      refresh: "test-refresh-token"
    };
    const env = {
      CHATGPT_OAUTH_TOKENS_B64: encodeChatGptOAuthTokens(tokens)
    };

    await expect(getStoredChatGptOAuthTokens(env)).resolves.toEqual(tokens);
    await expect(getStoredChatGptOAuthTokens({})).resolves.toEqual(tokens);

    await clearChatGptOAuthTokens();

    await expect(getStoredChatGptOAuthTokens(env)).resolves.toBeUndefined();
  }, 15_000);

  it("persists refreshed tokens to sync_state", async () => {
    useTempFinanceDb();
    const nextAccessToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    const accessToken = await getFreshChatGptOAuthAccessToken(
      {
        AI_FINANCES_ENABLE_CHATGPT_OAUTH: "1"
      },
      async (input) => {
        expect(input).toBe(chatGptOAuthTokenUrl);

        return new Response(
          JSON.stringify({
            access_token: nextAccessToken,
            refresh_token: "test-next-refresh-token"
          }),
          {
            headers: {
              "Content-Type": "application/json"
            },
            status: 200
          }
        );
      },
      saveChatGptOAuthTokens,
      async () => ({
        access: jwtWithExpiry(Date.now() - 60_000),
        expiry: Date.now() - 60_000,
        refresh: "test-refresh-token"
      })
    );

    expect(accessToken).toBe(nextAccessToken);
    await expect(getStoredChatGptOAuthTokens({})).resolves.toMatchObject({
      access: nextAccessToken,
      refresh: "test-next-refresh-token"
    });
  }, 15_000);

  it("refreshes expired tokens with a mocked auth.openai.com request", async () => {
    const nextAccessToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    const persisted: ChatGptOAuthTokens[] = [];
    const accessToken = await getFreshChatGptOAuthAccessToken(
      {
        AI_FINANCES_ENABLE_CHATGPT_OAUTH: "1"
      },
      async (input, init) => {
        expect(input).toBe(chatGptOAuthTokenUrl);
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
          grant_type: "refresh_token",
          refresh_token: "test-refresh-token"
        });

        return new Response(
          JSON.stringify({
            access_token: nextAccessToken,
            refresh_token: "test-next-refresh-token"
          }),
          {
            headers: {
              "Content-Type": "application/json"
            },
            status: 200
          }
        );
      },
      async (tokens) => {
        persisted.push(tokens);
      },
      async () => ({
        access: jwtWithExpiry(Date.now() - 60_000),
        expiry: Date.now() - 60_000,
        refresh: "test-refresh-token"
      })
    );

    expect(accessToken).toBe(nextAccessToken);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      access: nextAccessToken,
      refresh: "test-next-refresh-token"
    });
    expect(persisted[0]!.expiry).toBeGreaterThan(Date.now());
  });
});

function useTempFinanceDb(): void {
  testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-chatgpt-oauth-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testRoot, "db");
}

function jwtWithExpiry(expiryMs: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString("base64url"),
    Buffer.from(JSON.stringify({ exp: Math.floor(expiryMs / 1000) }), "utf8").toString("base64url"),
    "signature"
  ].join(".");
}
