// Public demo mode (KOBAN_PUBLIC_DEMO=1): the deployment serves only the
// synthetic ledger from demo-seed.ts, so every visitor is let in without
// signing in. Writes are refused at the proxy except the edits a visitor needs
// to try the product (a transaction's category, review state, or goal; a
// category's budget or color); no
// free text is accepted because every visitor shares the ledger, and the reseed
// wipes edits every few hours. The database name must still contain "demo"
// (assertDemoSeedTarget) before a reseed writes.
//
// The finance agent answers through the stateless stream endpoint, or, with a
// model the visitor runs in their own browser, through the stateless prompt and
// read-only tool endpoints.
// Conversations would be shared by every visitor, so the browser keeps each
// visitor's chats (agent-conversations-local.ts) and the server routes stay
// closed. The model account behind the agent is the owner's, so its provider,
// model, and sign-in state are masked (maskLlmStatusForPublicDemo).

import type { LlmProviderStatus } from "@/lib/llm-enrichment";
import type { WorkspaceEnv } from "@/lib/workspace-env";

export const publicDemoReadOnlyMessage = "This demo saves categories, reviews, and budgets only, and resets every few hours.";
export const publicDemoAgentMessage = "Chats in this demo stay in your browser.";
export const publicDemoUnavailableMessage = "This is not available in the public demo.";

const publicDemoAssistantPostRoutes: readonly RegExp[] = [
  /^\/api\/v1\/assistant\/stream$/,
  /^\/api\/v1\/assistant\/prompt$/,
  /^\/api\/v1\/assistant\/tools\/[a-z_]+$/
];

export function publicDemoRefusalMessage(pathname: string, method = "POST"): string {
  if (pathname.startsWith("/api/v1/assistant") || pathname.startsWith("/api/v1/conversations")) {
    return publicDemoAgentMessage;
  }
  return method === "GET" || method === "HEAD" ? publicDemoUnavailableMessage : publicDemoReadOnlyMessage;
}

// A refused API read answers 404, as if the route did not exist; a refused
// write answers 403 with the read-only explanation.
export function publicDemoRefusalStatus(method: string): 403 | 404 {
  return method === "GET" || method === "HEAD" ? 404 : 403;
}

export function isPublicDemo(env: Partial<WorkspaceEnv> = process.env as Partial<WorkspaceEnv>): boolean {
  return env.KOBAN_PUBLIC_DEMO?.trim() === "1";
}

// API reads an anonymous visitor may make: the ledger views the demo UI
// renders. Every other API route is refused, including ones that log in to a
// mail account, list mail accounts or local CLI paths, export the ledger,
// report provider setup, or write a row on GET. A new read route stays closed
// in the demo until it is added here.
const publicDemoApiReadRoutes: readonly RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/v1\/accounts$/,
  /^\/api\/v1\/accounts\/[^/]+$/,
  /^\/api\/v1\/categories$/,
  /^\/api\/v1\/dashboard-summary$/,
  /^\/api\/v1\/enrichment\/provider$/,
  /^\/api\/v1\/enrichment\/suggestions$/,
  /^\/api\/v1\/evidence$/,
  /^\/api\/v1\/goals$/,
  /^\/api\/v1\/icons\/[^/]+$/,
  /^\/api\/v1\/investments$/,
  /^\/api\/v1\/line-items$/,
  /^\/api\/v1\/recurrings$/,
  /^\/api\/v1\/rules$/,
  /^\/api\/v1\/rules\/preview$/,
  /^\/api\/v1\/search$/,
  /^\/api\/v1\/tag-colors$/,
  /^\/api\/v1\/transactions$/,
  /^\/api\/v1\/transactions\/[^/]+$/,
  /^\/api\/v1\/transactions\/[^/]+\/evidence$/,
  /^\/api\/v1\/transactions\/[^/]+\/line-items$/
];

// Pages are readable; API reads only from the allowlist above. Writes, OAuth
// starts for real providers, and auth endpoints are not.
export function isPublicDemoRequestAllowed(method: string, pathname: string): boolean {
  if (method === "POST") return publicDemoAssistantPostRoutes.some((route) => route.test(pathname));
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return publicDemoApiReadRoutes.some((route) => route.test(pathname));
  }
  return true;
}

// Keeps whether the agent is ready, drops what would name the model account.
export function maskLlmStatusForPublicDemo(
  status: LlmProviderStatus,
  env: Partial<WorkspaceEnv> = process.env as Partial<WorkspaceEnv>
): LlmProviderStatus {
  if (!isPublicDemo(env)) return status;
  return {
    configured: status.configured,
    model: status.configured ? "Koban" : undefined,
    provider: status.provider,
    status: status.status,
    timeoutMs: status.timeoutMs
  };
}

// Edits a visitor may make, per resource. None of these fields is free text.
const demoEditableResources: Array<{ fields: ReadonlySet<string>; path: RegExp }> = [
  {
    path: /^\/api\/v1\/transactions\/[^/]+$/,
    fields: new Set(["category_id", "categoryId", "reviewed", "financial_goal_id", "financialGoalId"])
  },
  {
    path: /^\/api\/v1\/categories\/[^/]+$/,
    fields: new Set(["budget_amount", "color"])
  }
];

function demoEditableFields(pathname: string): ReadonlySet<string> | undefined {
  return demoEditableResources.find((resource) => resource.path.test(pathname))?.fields;
}

export function isPublicDemoEditCandidate(method: string, pathname: string): boolean {
  return method === "PATCH" && demoEditableFields(pathname) !== undefined;
}

export function isPublicDemoEditAllowed(method: string, pathname: string, body: unknown): boolean {
  const fields = method === "PATCH" ? demoEditableFields(pathname) : undefined;
  if (!fields) return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every((key) => fields.has(key));
}

export function yesterdayIsoDate(now: Date = new Date()): string {
  const yesterday = new Date(now.getTime() - 86_400_000);
  return yesterday.toISOString().slice(0, 10);
}
