// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/login/route";
import { authCookieName } from "@/lib/auth";

const testToken = "unit-test-login-token";

afterEach(() => {
  delete process.env.AI_FINANCES_AUTH_TOKEN;
});

describe("login route", () => {
  it("sets a secure httpOnly session cookie after a valid token", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = await POST(createFormRequest({
      next: "/transactions?review=actionable",
      token: testToken
    }));
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3008/transactions?review=actionable");
    expect(setCookie).toContain(`${authCookieName}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects an invalid JSON token without setting a cookie", async () => {
    process.env.AI_FINANCES_AUTH_TOKEN = testToken;

    const response = await POST(new NextRequest("http://localhost:3008/api/login", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token: "wrong-token"
      })
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Invalid token." });
  });
});

function createFormRequest(fields: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3008/api/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(fields).toString()
  });
}
