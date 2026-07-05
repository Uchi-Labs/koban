// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { middleware } from "../middleware";
import { authCookieName } from "@/lib/auth";

const testToken = "unit-test-auth-token";

afterEach(() => {
  delete process.env.AI_FINANCES_AUTH_TOKEN;
});

describe("auth middleware", () => {
  it("passes through when hosted auth is not configured", () => {
    const response = middleware(createRequest("/api/v1/transactions"));

    expect(response.status).toBe(200);
  });

  it("requires auth for API requests when hosted auth is configured", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = middleware(createRequest("/api/v1/transactions"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required." });
  });

  it("accepts the session cookie", () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = middleware(createRequest("/api/v1/transactions", {
      headers: {
        cookie: `${authCookieName}=${testToken}`
      }
    }));

    expect(response.status).toBe(200);
  });

  it("accepts a bearer token", () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = middleware(createRequest("/api/v1/transactions", {
      headers: {
        authorization: `Bearer ${testToken}`
      }
    }));

    expect(response.status).toBe(200);
  });

  it("keeps health unauthenticated", () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = middleware(createRequest("/api/health"));

    expect(response.status).toBe(200);
  });
});

function createRequest(pathName: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(pathName, "http://localhost:3008"), init);
}
