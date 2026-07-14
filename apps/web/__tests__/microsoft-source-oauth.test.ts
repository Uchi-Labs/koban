// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMicrosoftSourceOAuthStart,
  encodeMicrosoftSourceOAuthPendingState,
  exchangeMicrosoftSourceOAuthCode,
  fetchMicrosoftSourceRecords,
  getFreshMicrosoftSourceAccessToken,
  isMicrosoftSourceOAuthPendingStateExpired,
  microsoftSourceOAuthAuthorizeUrl,
  microsoftSourceOAuthTokenUrl,
  microsoftSourceOAuthTokensStateKey,
  microsoftSourceOAuthStatus,
  parseMicrosoftSourceOAuthPendingState,
  saveMicrosoftSourceOAuthTokens,
  type MicrosoftSourceOAuthTokens
} from "@/lib/microsoft-source-oauth";
import { closeFinanceDbForTests, readSyncStateValue } from "@/lib/db/finance-db";

const testEnv = {
  MICROSOFT_SOURCE_CLIENT_ID: "test-client-id",
  MICROSOFT_SOURCE_CLIENT_SECRET: "test-client-secret",
  MICROSOFT_SOURCE_TOKEN_ENCRYPTION_KEY: "test-encryption-key"
};

let testRoot: string | undefined;

afterEach(async () => {
  await closeFinanceDbForTests();
  delete process.env.AI_FINANCES_PGLITE_DIR;

  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = undefined;
  }
});

describe("Microsoft source OAuth", () => {
  it("creates a PKCE authorization request with only read scopes and seals pending state", () => {
    const { authorizationUrl, pendingState } = createMicrosoftSourceOAuthStart(
      "https://finances.example/api/auth/microsoft/callback",
      testEnv
    );
    const url = new URL(authorizationUrl);

    expect(`${url.origin}${url.pathname}`).toBe(microsoftSourceOAuthAuthorizeUrl);
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["offline_access", "User.Read", "Mail.Read", "Calendars.Read"])
    );
    expect(url.searchParams.get("scope")).not.toContain("Mail.ReadWrite");
    expect(url.searchParams.get("scope")).not.toContain("Mail.Send");

    const encoded = encodeMicrosoftSourceOAuthPendingState(pendingState, testEnv);
    expect(encoded).not.toContain(pendingState.codeVerifier);
    expect(parseMicrosoftSourceOAuthPendingState(encoded, testEnv)).toEqual(pendingState);
    expect(parseMicrosoftSourceOAuthPendingState(encoded, { ...testEnv, MICROSOFT_SOURCE_TOKEN_ENCRYPTION_KEY: "wrong" })).toBeUndefined();
    expect(isMicrosoftSourceOAuthPendingStateExpired(pendingState, pendingState.createdAt + 60_000)).toBe(false);
    expect(isMicrosoftSourceOAuthPendingStateExpired(pendingState, pendingState.createdAt + 11 * 60_000)).toBe(true);
  });

  it("exchanges an authorization code as a confidential PKCE client", async () => {
    const tokens = await exchangeMicrosoftSourceOAuthCode({
      code: "test-code",
      codeVerifier: "test-verifier",
      env: testEnv,
      fetcher: async (input, init) => {
        expect(input).toBe(microsoftSourceOAuthTokenUrl);
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("client_id")).toBe("test-client-id");
        expect(body.get("client_secret")).toBe("test-client-secret");
        expect(body.get("code_verifier")).toBe("test-verifier");
        expect(body.get("grant_type")).toBe("authorization_code");
        return Response.json({
          access_token: "test-access-token",
          expires_in: 3600,
          refresh_token: "test-refresh-token"
        });
      },
      redirectUri: "https://finances.example/api/auth/microsoft/callback"
    });

    expect(tokens).toMatchObject({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token"
    });
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("encrypts saved credentials in sync_state and reports the connected account", async () => {
    useTempFinanceDb();
    const tokens: MicrosoftSourceOAuthTokens = {
      accessToken: "sensitive-access-token",
      account: {
        email: "person@example.com",
        id: "account-id",
        name: "Example Person"
      },
      expiresAt: Date.now() + 60 * 60 * 1000,
      refreshToken: "sensitive-refresh-token"
    };

    await saveMicrosoftSourceOAuthTokens(tokens, testEnv);
    const stored = await readSyncStateValue(microsoftSourceOAuthTokensStateKey);

    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain(tokens.accessToken);
    expect(stored).not.toContain(tokens.refreshToken);
    await expect(microsoftSourceOAuthStatus(testEnv)).resolves.toMatchObject({
      accountEmail: "person@example.com",
      configured: true,
      connected: true
    });
  }, 15_000);

  it("refreshes expired access and refresh tokens", async () => {
    const original: MicrosoftSourceOAuthTokens = {
      accessToken: "expired-access",
      expiresAt: Date.now() - 1,
      refreshToken: "original-refresh"
    };
    const persisted: MicrosoftSourceOAuthTokens[] = [];
    const accessToken = await getFreshMicrosoftSourceAccessToken(
      testEnv,
      async (input, init) => {
        expect(input).toBe(microsoftSourceOAuthTokenUrl);
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("refresh_token")).toBe("original-refresh");
        return Response.json({
          access_token: "fresh-access",
          expires_in: 3600,
          refresh_token: "rotated-refresh"
        });
      },
      async (tokens) => {
        persisted.push(tokens);
      },
      async () => original
    );

    expect(accessToken).toBe("fresh-access");
    expect(persisted[0]).toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "rotated-refresh"
    });
  });

  it("reads recent messages and calendar events from Microsoft Graph", async () => {
    useTempFinanceDb();
    await saveMicrosoftSourceOAuthTokens(
      {
        accessToken: "fresh-access",
        expiresAt: Date.now() + 60 * 60 * 1000,
        refreshToken: "refresh-token"
      },
      testEnv
    );

    const records = await fetchMicrosoftSourceRecords(testEnv, async (input, init) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fresh-access");

      if (url.pathname.endsWith("/messages")) {
        expect(url.searchParams.get("$select")).toContain("bodyPreview");
        return Response.json({ value: [{ id: "message-1", subject: "Your receipt" }] });
      }

      expect(url.pathname.endsWith("/calendarView")).toBe(true);
      return Response.json({ value: [{ id: "event-1", subject: "Trip", start: { dateTime: "2026-08-01" } }] });
    });

    expect(records).toEqual([
      { id: "message-1", subject: "Your receipt" },
      { id: "event-1", subject: "Trip", start: { dateTime: "2026-08-01" } }
    ]);
  }, 15_000);
});

function useTempFinanceDb(): void {
  testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-microsoft-oauth-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testRoot, "db");
}
