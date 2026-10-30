// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy as middleware } from "../proxy";
import { POST as resetLocalData } from "@/app/api/v1/local-data/reset/route";
import { authCookieName, canCreateBetterAuthUser, setBetterAuthForTests } from "@/lib/auth";

const testToken = "unit-test-auth-token";
let testRoot: string | null = null;

beforeEach(() => {
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (testRoot) {
    rmSync(testRoot, { force: true, recursive: true });
    testRoot = null;
  }
  delete process.env.AI_FINANCES_AUTH_TOKEN;
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.DATABASE_URL;
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  setBetterAuthForTests(null);
});

describe("auth middleware", () => {
  it.each(["/api/v1/icons/chase.com", "/api/v1/transactions/plaid.example"])(
    "matches and authenticates dotted API path %s",
    async (url) => {
      process.env.AI_FINANCES_AUTH_TOKEN = testToken;
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
      expect((await middleware(createRequest(url))).status).toBe(401);
    }
  );

  it("keeps static assets outside the auth matcher", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/_next/static/app.js" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, url: "/icons/icon-192.png" })).toBe(false);
  });

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

  it("rejects an unverified better-auth session cookie for a page request", async () => {
    process.env.BETTER_AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgres://unit-test";
    setBetterAuthForTests({
      api: {
        getSession: async () => null
      },
      handler: async () => new Response(null)
    } as unknown as Parameters<typeof setBetterAuthForTests>[0]);

    const response = await middleware(createRequest("/transactions", {
      headers: {
        cookie: "better-auth.session_token=garbage"
      }
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3008/login?next=%2Ftransactions");
  });

  it("accepts a verified better-auth session for a page request", async () => {
    process.env.BETTER_AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgres://unit-test";
    setBetterAuthForTests({
      api: {
        getSession: async () => ({ session: { id: "session-owner" }, user: { id: "user-owner" } })
      },
      handler: async () => new Response(null)
    } as unknown as Parameters<typeof setBetterAuthForTests>[0]);

    const response = await middleware(createRequest("/transactions", {
      headers: {
        cookie: "better-auth.session_token=verified-by-test-double"
      }
    }));

    expect(response.status).toBe(200);
  });

  it("loads hosted auth configuration from the workspace env once process env is empty", async () => {
    testRoot = mkdtempSync(path.join(tmpdir(), "ai-finances-auth-env-"));
    writeFileSync(path.join(testRoot, "pnpm-workspace.yaml"), "packages: []\n");
    writeFileSync(
      path.join(testRoot, ".env"),
      [
        "AI_FINANCES_AUTH_TOKEN=workspace-legacy-token",
        "BETTER_AUTH_SECRET=workspace-test-secret",
        "DATABASE_URL=postgres://workspace-test"
      ].join("\n")
    );
    vi.spyOn(process, "cwd").mockReturnValue(testRoot);
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "0";
    setBetterAuthForTests({
      api: {
        getSession: async () => {
          throw new APIError("UNAUTHORIZED", { message: "Invalid API key" });
        }
      },
      handler: async () => new Response(null)
    } as unknown as Parameters<typeof setBetterAuthForTests>[0]);

    const response = await middleware(createRequest("/api/v1/transactions", {
      headers: {
        authorization: "Bearer unknown-workspace-token"
      }
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required." });
  });

  it("treats a rejected better-auth bearer as unauthenticated", async () => {
    process.env.BETTER_AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgres://unit-test";
    setBetterAuthForTests({
      api: {
        getSession: async () => {
          throw new APIError("FORBIDDEN", { message: "Invalid API key" });
        }
      },
      handler: async () => new Response(null)
    } as unknown as Parameters<typeof setBetterAuthForTests>[0]);

    const response = await middleware(createRequest("/api/v1/transactions", {
      headers: {
        authorization: "Bearer unknown-api-key"
      }
    }));

    expect(response.status).toBe(401);
  });

  it("does not hide better-auth database failures", async () => {
    process.env.BETTER_AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgres://unit-test";
    const databaseFailure = new APIError("INTERNAL_SERVER_ERROR", {
      message: "database connection failed"
    });
    setBetterAuthForTests({
      api: {
        getSession: async () => {
          throw databaseFailure;
        }
      },
      handler: async () => new Response(null)
    } as unknown as Parameters<typeof setBetterAuthForTests>[0]);

    await expect(middleware(createRequest("/api/v1/transactions", {
      headers: {
        authorization: "Bearer unknown-api-key"
      }
    }))).rejects.toBe(databaseFailure);
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
