import type { BrowserToolDefinition, ParsedToolCall } from "./tool-calls";

type FetchLike = typeof fetch;

/**
 * Runs a ledger tool the in-browser model asked for through Koban's own API,
 * same origin and same session as the page. Failures come back as an `error`
 * the model reads, as server Ask reports a tool error to its model.
 */
export async function executeBrowserToolCall(
  call: ParsedToolCall,
  tools: BrowserToolDefinition[],
  { fetcher = fetch, signal }: { fetcher?: FetchLike; signal?: AbortSignal } = {}
): Promise<unknown> {
  if (!tools.some((tool) => tool.name === call.name)) {
    return { error: `There is no tool named ${call.name}. Use one of: ${tools.map((tool) => tool.name).join(", ")}.` };
  }

  const response = await fetcher(`/api/v1/assistant/tools/${encodeURIComponent(call.name)}`, {
    body: JSON.stringify(call.arguments),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal
  });
  const body = (await response.json().catch(() => ({}))) as { error?: unknown; result?: unknown };

  if (!response.ok) {
    return { error: apiErrorMessage(body.error) ?? `The tool failed (HTTP ${response.status}).` };
  }

  return body.result ?? null;
}

/** Koban's API answers errors as `{ error: "…" }` or `{ error: { message } }`. */
export function apiErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string" && error) return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : undefined;
}
