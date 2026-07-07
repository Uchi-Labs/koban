// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy as middleware } from "../proxy";
import { POST as resetLocalData } from "@/app/api/v1/local-data/reset/route";
import { authCookieName, canCreateBetterAuthUser, setBetterAuthForTests } from "@/lib/auth";

const testToken = "unit-test-auth-token";

afterEach(() => {
  delete process.env.AI_FINANCES_AUTH_TOKEN;
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.DATABASE_URL;
  setBetterAuthForTests(null);
});

describe("auth middleware", () => {
  it("passes through when hosted auth is not configured", async () => {
    const response = await middleware(createRequest("/api/v1/transactions"));

    expect(response.status).toBe(200);
  });

  it("requires auth for API requests when hosted auth is configured", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = await middleware(createRequest("/api/v1/transactions"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required." });
  });

  it("accepts the session cookie", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = await middleware(createRequest("/api/v1/transactions", {
      headers: {
        cookie: `${authCookieName}=${testToken}`
      }
    }));

    expect(response.status).toBe(200);
  });

  it("accepts a legacy bearer token", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = await middleware(createRequest("/api/v1/transactions", {
      headers: {
        authorization: `Bearer ${testToken}`
      }
    }));

    expect(response.status).toBe(200);
  });

  it("accepts a legacy bearer token in hosted mode", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;
    process.env.BETTER_AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgres://unit-test";

    const response = await middleware(createRequest("/api/v1/transactions", {
      headers: {
        authorization: `Bearer ${testToken}`
      }
    }));

    expect(response.status).toBe(200);
  });

  it("accepts a better-auth api key bearer in hosted mode", async () => {
    process.env.BETTER_AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgres://unit-test";
    setBetterAuthForTests({
      api: {
        getSession: async ({ headers }: { headers: Headers }) => (
          headers.get("authorization") === "Bearer af_unit_test_api_key"
            ? { session: { id: "session-api-key" }, user: { id: "user-owner" } }
            : null
        )
      },
      handler: async () => new Response(null)
    } as unknown as Parameters<typeof setBetterAuthForTests>[0]);

    const response = await middleware(createRequest("/api/v1/transactions", {
      headers: {
        authorization: "Bearer af_unit_test_api_key"
      }
    }));

    expect(response.status).toBe(200);
  });

  it("closes registration after the first better-auth user exists", () => {
    expect(canCreateBetterAuthUser(0)).toBe(true);
    expect(canCreateBetterAuthUser(1)).toBe(false);
  });

  it("keeps health unauthenticated", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = await middleware(createRequest("/api/health"));

    expect(response.status).toBe(200);
  });

  it("requires auth in the local-data reset handler when hosted auth is configured", async () => {
    process.env.BETTER_AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgres://unit-test";
    setBetterAuthForTests({
      api: {
        getSession: async () => null
      },
      handler: async () => new Response(null)
    } as unknown as Parameters<typeof setBetterAuthForTests>[0]);

    const response = await resetLocalData(new Request("http://localhost/api/v1/local-data/reset", {
      body: JSON.stringify({ confirmation: "DELETE LOCAL DATA" }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required." });
  });
});

function createRequest(pathName: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(pathName, "http://localhost:3008"), init);
}
