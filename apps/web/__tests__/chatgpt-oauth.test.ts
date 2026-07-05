import { describe, expect, it } from "vitest";
import {
  chatGptOAuthTokenUrl,
  encodeChatGptOAuthTokens,
  getFreshChatGptOAuthAccessToken,
  type ChatGptOAuthTokens
} from "@/lib/ai/chatgpt-oauth";

describe("chatgpt oauth", () => {
  it("returns saved access tokens without live refresh while they are fresh", async () => {
    const tokens: ChatGptOAuthTokens = {
      access: jwtWithExpiry(Date.now() + 60 * 60 * 1000),
      expiry: Date.now() + 60 * 60 * 1000,
      refresh: "test-refresh-token"
    };
    const accessToken = await getFreshChatGptOAuthAccessToken(
      {
        AI_FINANCES_ENABLE_CHATGPT_OAUTH: "1",
        CHATGPT_OAUTH_TOKENS_B64: encodeChatGptOAuthTokens(tokens)
      },
      async () => {
        throw new Error("refresh should not be called");
      },
      async () => {
        throw new Error("fresh tokens should not be persisted");
      }
    );

    expect(accessToken).toBe(tokens.access);
  });

  it("refreshes expired tokens with a mocked auth.openai.com request", async () => {
    const nextAccessToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    const persisted: ChatGptOAuthTokens[] = [];
    const accessToken = await getFreshChatGptOAuthAccessToken(
      {
        AI_FINANCES_ENABLE_CHATGPT_OAUTH: "1",
        CHATGPT_OAUTH_TOKENS_B64: encodeChatGptOAuthTokens({
          access: jwtWithExpiry(Date.now() - 60_000),
          expiry: Date.now() - 60_000,
          refresh: "test-refresh-token"
        })
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
      }
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

function jwtWithExpiry(expiryMs: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString("base64url"),
    Buffer.from(JSON.stringify({ exp: Math.floor(expiryMs / 1000) }), "utf8").toString("base64url"),
    "signature"
  ].join(".");
}
