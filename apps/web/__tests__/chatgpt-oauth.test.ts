// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthSession, type CredentialStore, type TokenSet } from "chatgpt-oauth";
import {
  chatGptOAuthStatus,
  chatGptOAuthTokensStateKey,
  chatGptOAuthTokenUrl,
  chatgptCredentialStore,
  chatgptSubject,
  clearChatGptOAuthTokens,
  createChatGptCredentialStore,
  encodeChatGptOAuthTokens,
  getStoredChatGptOAuthSession
} from "@/lib/ai/chatgpt-oauth";
import { closeFinanceDbForTests, readSyncStateValue } from "@/lib/db/finance-db";

let testRoot: string | undefined;

afterEach(async () => {
  await closeFinanceDbForTests();
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.CODEX_HOME;

  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = undefined;
  }
});

describe("chatgpt oauth", () => {
  // These tests exercise the same behavior the deleted hand-rolled module
  // covered, but through the new seam: the CredentialStore adapter over
  // sync_state plus the chatgpt-oauth package's auth session.

  it("returns saved access tokens without live refresh while they are fresh", async () => {
    useTempFinanceDb();
    const store = createChatGptCredentialStore();
    const accessToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    await seedToken(store, { accessToken, expiresAt: Date.now() + 60 * 60 * 1000 });

    const auth = createAuthSession({
      store,
      fetch: async () => {
        throw new Error("refresh should not be called");
      }
    });

    await expect(auth.getAccessToken(chatgptSubject)).resolves.toBe(accessToken);
  }, 15_000);

  it("persists saved credentials in sync_state and clears them on logout", async () => {
    useTempFinanceDb();
    const accessToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    await seedToken(chatgptCredentialStore, { accessToken, expiresAt: Date.now() + 60 * 60 * 1000 });

    // The credential is base64-JSON encoded under the legacy state key.
    const raw = await readSyncStateValue(chatGptOAuthTokensStateKey);
    expect(raw).toBeDefined();
    expect(JSON.parse(Buffer.from(raw as string, "base64").toString("utf8"))).toMatchObject({
      accessToken,
      refreshToken: "test-refresh-token"
    });

    await expect(getStoredChatGptOAuthSession({})).resolves.not.toBeNull();

    await clearChatGptOAuthTokens();

    await expect(getStoredChatGptOAuthSession({})).resolves.toBeNull();
  }, 15_000);

  it("seeds tokens from env once, then treats sync_state as the source of truth", async () => {
    useTempFinanceDb();
    const env = {
      CHATGPT_OAUTH_TOKENS_B64: encodeChatGptOAuthTokens({
        access: jwtWithExpiry(Date.now() + 60 * 60 * 1000),
        expiry: Date.now() + 60 * 60 * 1000,
        refresh: "test-refresh-token"
      })
    };

    await expect(getStoredChatGptOAuthSession(env)).resolves.not.toBeNull();
    // Persisted: still connected even without the env var present.
    await expect(getStoredChatGptOAuthSession({})).resolves.not.toBeNull();

    await clearChatGptOAuthTokens();

    // The seed sentinel prevents a cleared credential from being re-seeded.
    await expect(getStoredChatGptOAuthSession(env)).resolves.toBeNull();
  }, 15_000);

  it("reports connected status with an expiry once a credential is stored", async () => {
    useTempFinanceDb();
    const expiresAt = Date.now() + 60 * 60 * 1000;
    await seedToken(chatgptCredentialStore, { accessToken: jwtWithExpiry(expiresAt), expiresAt });

    const status = await chatGptOAuthStatus({ AI_FINANCES_ENABLE_CHATGPT_OAUTH: "1" });

    expect(status.connected).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.expiresAt).toBe(new Date(expiresAt).toISOString());
  }, 15_000);

  it("refreshes an expired token through auth.openai.com and persists the rotation", async () => {
    useTempFinanceDb();
    const store = createChatGptCredentialStore();
    await seedToken(store, {
      accessToken: jwtWithExpiry(Date.now() - 60_000),
      expiresAt: Date.now() - 60_000
    });

    const nextAccessToken = jwtWithExpiry(Date.now() + 60 * 60 * 1000);
    const requests: Array<{ url: string; body: URLSearchParams }> = [];
    const auth = createAuthSession({
      store,
      fetch: async (input, init) => {
        requests.push({ url: String(input), body: new URLSearchParams(String(init?.body)) });

        return new Response(
          JSON.stringify({
            access_token: nextAccessToken,
            refresh_token: "test-next-refresh-token",
            expires_in: 3600
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      }
    });

    await expect(auth.getAccessToken(chatgptSubject)).resolves.toBe(nextAccessToken);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(chatGptOAuthTokenUrl);
    expect(requests[0]!.body.get("grant_type")).toBe("refresh_token");
    expect(requests[0]!.body.get("refresh_token")).toBe("test-refresh-token");

    // The rotated credential is now the stored source of truth.
    const persisted = await store.load(chatgptSubject);
    expect(persisted).toMatchObject({ accessToken: nextAccessToken, refreshToken: "test-next-refresh-token" });
  }, 15_000);
});

async function seedToken(
  store: CredentialStore,
  partial: { accessToken: string; expiresAt: number; refreshToken?: string }
): Promise<void> {
  const current = await store.load(chatgptSubject);
  const expectedVersion = current?.version ?? 0;
  const next: TokenSet = {
    accessToken: partial.accessToken,
    refreshToken: partial.refreshToken ?? "test-refresh-token",
    expiresAt: partial.expiresAt,
    version: expectedVersion + 1
  };
  const result = await store.compareAndSwap(chatgptSubject, expectedVersion, next);
  expect(result.ok).toBe(true);
}

function useTempFinanceDb(): void {
  testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-chatgpt-oauth-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testRoot, "db");
  // Point CODEX_HOME at the empty temp dir so the ~/.codex/auth.json import
  // fallback is a deterministic no-op regardless of the host machine.
  process.env.CODEX_HOME = testRoot;
}

function jwtWithExpiry(expiryMs: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString("base64url"),
    Buffer.from(JSON.stringify({ exp: Math.floor(expiryMs / 1000) }), "utf8").toString("base64url"),
    "signature"
  ].join(".");
}
