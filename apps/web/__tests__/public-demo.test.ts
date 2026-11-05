import { describe, expect, it } from "vitest";
import { authenticateApiRequest } from "@/lib/auth";
import {
  isPublicDemo,
  isPublicDemoEditAllowed,
  isPublicDemoRequestAllowed,
  maskLlmStatusForPublicDemo,
  yesterdayIsoDate
} from "@/lib/public-demo";
import { resetPublicDemoRateLimits, takePublicDemoQuestion } from "@/lib/public-demo-rate-limit";

describe("public demo", () => {
  it("is only on when KOBAN_PUBLIC_DEMO is exactly 1", () => {
    expect(isPublicDemo({ KOBAN_PUBLIC_DEMO: "1" })).toBe(true);
    expect(isPublicDemo({ KOBAN_PUBLIC_DEMO: "true" })).toBe(false);
    expect(isPublicDemo({})).toBe(false);
  });

  it("allows reads and refuses writes and provider OAuth", () => {
    expect(isPublicDemoRequestAllowed("GET", "/transactions")).toBe(true);
    expect(isPublicDemoRequestAllowed("GET", "/api/v1/transactions")).toBe(true);
    expect(isPublicDemoRequestAllowed("HEAD", "/")).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isPublicDemoRequestAllowed(method, "/api/v1/transactions/demo_txn_00001")).toBe(false);
      expect(isPublicDemoRequestAllowed(method, "/api/better-auth/sign-in/email")).toBe(false);
    }
    expect(isPublicDemoRequestAllowed("GET", "/api/auth/microsoft/start")).toBe(false);
    expect(isPublicDemoRequestAllowed("GET", "/api/auth/chatgpt/callback")).toBe(false);
  });

  it("serves only allowlisted API reads", () => {
    for (const path of [
      "/api/v1/accounts",
      "/api/v1/categories",
      "/api/v1/dashboard-summary",
      "/api/v1/icons/chase.com",
      "/api/v1/transactions/demo_txn_00001",
      "/api/v1/transactions/demo_txn_00001/evidence"
    ]) {
      expect(isPublicDemoRequestAllowed("GET", path)).toBe(true);
    }
    for (const path of [
      "/api/v1/mail-accounts",
      "/api/v1/mail-accounts/icloud_1/verify",
      "/api/v1/sources",
      "/api/v1/sources/source_shop_orders/session",
      "/api/v1/source-items",
      "/api/v1/backups/ledger",
      "/api/v1/sync-runs",
      "/api/v1/sync-schedule",
      "/api/v1/plaid/status",
      "/api/v1/simplefin/status",
      "/api/v1/snaptrade/status",
      "/api/better-auth/get-session",
      "/api/v1/some-future-route"
    ]) {
      expect(isPublicDemoRequestAllowed("GET", path)).toBe(false);
      expect(isPublicDemoRequestAllowed("HEAD", path)).toBe(false);
    }
  });

  it("opens only the stateless agent stream and keeps shared conversations closed", () => {
    expect(isPublicDemoRequestAllowed("POST", "/api/v1/assistant/stream")).toBe(true);
    // A model in the visitor's own browser reads the question's prompt and the read-only ledger tools.
    expect(isPublicDemoRequestAllowed("POST", "/api/v1/assistant/prompt")).toBe(true);
    expect(isPublicDemoRequestAllowed("POST", "/api/v1/assistant/tools/search_transactions")).toBe(true);
    expect(isPublicDemoRequestAllowed("POST", "/api/v1/assistant/tools/a/b")).toBe(false);
    expect(isPublicDemoRequestAllowed("GET", "/api/v1/assistant/prompt")).toBe(false);
    expect(isPublicDemoRequestAllowed("POST", "/api/v1/assistant")).toBe(false);
    expect(isPublicDemoRequestAllowed("GET", "/api/v1/assistant")).toBe(false);
    expect(isPublicDemoRequestAllowed("GET", "/api/v1/conversations")).toBe(false);
    expect(isPublicDemoRequestAllowed("POST", "/api/v1/conversations")).toBe(false);
    expect(isPublicDemoRequestAllowed("POST", "/api/v1/conversations/conv_1/turns")).toBe(false);
  });

  it("masks the model account behind the agent", () => {
    const status = {
      baseUrl: "https://chatgpt.com/backend-api/codex",
      chatGptOAuthConnected: true,
      chatGptOAuthEnabled: true,
      configured: true,
      credentialSource: "chatgpt_oauth" as const,
      model: "gpt-5.5",
      provider: "openai_compatible" as const,
      status: "connected" as const,
      timeoutMs: 30_000
    };
    const masked = maskLlmStatusForPublicDemo(status, { KOBAN_PUBLIC_DEMO: "1" });
    expect(JSON.stringify(masked)).not.toMatch(/chatgpt|gpt-5/i);
    expect(masked).toMatchObject({ configured: true, model: "Koban", status: "connected" });
    expect(maskLlmStatusForPublicDemo(status, {})).toBe(status);
  });

  it("caps agent questions per visitor per hour", () => {
    resetPublicDemoRateLimits();
    const start = Date.UTC(2026, 9, 1, 12);
    for (let index = 0; index < 12; index += 1) {
      expect(takePublicDemoQuestion("203.0.113.7", start + index).allowed).toBe(true);
    }
    expect(takePublicDemoQuestion("203.0.113.7", start + 20).allowed).toBe(false);
    expect(takePublicDemoQuestion("198.51.100.4", start + 20).allowed).toBe(true);
    expect(takePublicDemoQuestion("203.0.113.7", start + 60 * 60_000 + 1).allowed).toBe(true);
    resetPublicDemoRateLimits();
  });

  it("accepts only category, review, and goal edits on a single transaction", () => {
    const path = "/api/v1/transactions/demo_txn_00001";
    expect(isPublicDemoEditAllowed("PATCH", path, { category_id: "cat_food", reviewed: true })).toBe(true);
    expect(isPublicDemoEditAllowed("PATCH", path, { reviewed: false })).toBe(true);
    expect(isPublicDemoEditAllowed("PATCH", path, { financial_goal_id: null })).toBe(true);
    expect(isPublicDemoEditAllowed("PATCH", path, { notes: "anything" })).toBe(false);
    expect(isPublicDemoEditAllowed("PATCH", path, { reviewed: true, tags: ["x"] })).toBe(false);
    expect(isPublicDemoEditAllowed("PATCH", path, {})).toBe(false);
    expect(isPublicDemoEditAllowed("PATCH", path, null)).toBe(false);
    expect(isPublicDemoEditAllowed("POST", path, { reviewed: true })).toBe(false);
    expect(isPublicDemoEditAllowed("PATCH", "/api/v1/transactions/bulk-categorize/extra", { reviewed: true })).toBe(false);
    expect(isPublicDemoEditAllowed("PATCH", "/api/v1/categories/cat_food", { name: "x" })).toBe(false);
    expect(isPublicDemoEditAllowed("PATCH", "/api/v1/categories/cat_food", { budget_amount: 1_400 })).toBe(true);
    expect(isPublicDemoEditAllowed("PATCH", "/api/v1/categories/cat_food", { budget_amount: 1_400, emoji: "x" })).toBe(false);
    expect(isPublicDemoEditAllowed("DELETE", "/api/v1/categories/cat_food", { reassign_to: "cat_other" })).toBe(false);
  });

  it("lets anonymous requests read without a session in demo mode only", async () => {
    const request = new Request("http://demo.invalid/api/v1/accounts");
    const env = { DATABASE_URL: "postgresql://demo.invalid/koban_demo" };

    await expect(authenticateApiRequest(request, { ...env, KOBAN_PUBLIC_DEMO: "1" })).resolves.toEqual({
      authenticated: true,
      method: "public_demo"
    });
    await expect(authenticateApiRequest(request, { AI_FINANCES_AUTH_TOKEN: "secret" })).resolves.toEqual({ authenticated: false });
  });

  it("anchors the ledger on the previous UTC day", () => {
    expect(yesterdayIsoDate(new Date("2026-10-28T03:00:00.000Z"))).toBe("2026-10-27");
    expect(yesterdayIsoDate(new Date("2026-03-01T00:30:00.000Z"))).toBe("2026-02-28");
  });
});
