// Public demo mode (KOBAN_PUBLIC_DEMO=1): the deployment serves only the
// synthetic ledger from demo-seed.ts, so every visitor is let in without
// signing in. Writes are refused at the proxy except the edits a visitor needs
// to try the product (a transaction's category, review state, or goal; a
// category's budget or color); no
// free text is accepted because every visitor shares the ledger, and the reseed
// wipes edits every few hours. The database name must still contain "demo"
// (assertDemoSeedTarget) before a reseed writes.
//
// The finance agent answers through the stateless stream endpoint only.
// Conversations would be shared by every visitor, so the browser keeps each
// visitor's chats (agent-conversations-local.ts) and the server routes stay
// closed. The model account behind the agent is the owner's, so its provider,
// model, and sign-in state are masked (maskLlmStatusForPublicDemo).

import type { LlmProviderStatus } from "@/lib/llm-enrichment";
import type { WorkspaceEnv } from "@/lib/workspace-env";

export const publicDemoReadOnlyMessage = "This demo saves categories, reviews, and budgets only, and resets every few hours.";
export const publicDemoAgentMessage = "Chats in this demo stay in your browser.";

const publicDemoAssistantStreamPath = "/api/v1/assistant/stream";

export function publicDemoRefusalMessage(pathname: string): string {
  return pathname.startsWith("/api/v1/assistant") || pathname.startsWith("/api/v1/conversations")
    ? publicDemoAgentMessage
    : publicDemoReadOnlyMessage;
}

export function isPublicDemo(env: Partial<WorkspaceEnv> = process.env as Partial<WorkspaceEnv>): boolean {
  return env.KOBAN_PUBLIC_DEMO?.trim() === "1";
}

// Reads that are safe for anonymous visitors. Writes, OAuth starts for real
// providers, and auth endpoints that could change credentials are not.
export function isPublicDemoRequestAllowed(method: string, pathname: string): boolean {
  if (method === "POST") return pathname === publicDemoAssistantStreamPath;
  if (method !== "GET" && method !== "HEAD") return false;
  return !pathname.startsWith("/api/auth/") &&
    !pathname.startsWith("/api/v1/assistant") &&
    !pathname.startsWith("/api/v1/conversations");
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
