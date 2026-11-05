// The API error envelope, shared by the server mapper (lib/effect/errors.ts)
// and the browser. Routes not yet on `handler()` still answer the older
// `{error: "message"}` shape, so readers accept both until every route is ported.

export type ApiErrorType = "invalid_request_error" | "authentication_error" | "permission_error" | "api_error";

export interface ApiErrorBody {
  error: {
    type: ApiErrorType;
    code: string;
    message: string;
    param?: string;
    request_id?: string;
  };
}

/** The caller-facing message from an error response body in either shape, or `fallback`. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
