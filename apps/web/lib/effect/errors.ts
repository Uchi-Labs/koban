import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";
import type { ApiErrorBody, ApiErrorType } from "@/lib/api-error-envelope";

// Errors a route handler may fail with. HttpErrorMapper below is the one place
// that turns them into the API error envelope (`{error: {type, code, message,
// param}}`); handlers never build error bodies themselves.

/** 400: the request body or a parameter is wrong. `reason` is shown to the caller as-is. */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {
  reason: Schema.String,
  param: Schema.optional(Schema.String),
  missing: Schema.optional(Schema.Boolean)
}) {
  override get message(): string {
    return this.reason;
  }
}

/** 404: `resource` is the caller-facing name, such as "Rule" or "Financial goal". */
export class ResourceNotFound extends Schema.TaggedError<ResourceNotFound>()("ResourceNotFound", {
  resource: Schema.String,
  id: Schema.String
}) {
  override get message(): string {
    return `${this.resource} not found.`;
  }
}

/** 409: the request conflicts with current state. */
export class ResourceConflict extends Schema.TaggedError<ResourceConflict>()("ResourceConflict", {
  reason: Schema.String
}) {
  override get message(): string {
    return this.reason;
  }
}

/** 503: a provider the request needs has no credentials on this server. */
export class ProviderNotConfigured extends Schema.TaggedError<ProviderNotConfigured>()("ProviderNotConfigured", {
  provider: Schema.String
}) {
  override get message(): string {
    return `${this.provider} is not configured on this server.`;
  }
}

/** 502: a provider answered with an error. Its status is kept for logs and never copied to our response. */
export class ProviderUpstreamError extends Schema.TaggedError<ProviderUpstreamError>()("ProviderUpstreamError", {
  provider: Schema.String,
  status: Schema.optional(Schema.Number),
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `${this.provider} returned an error.`;
  }
}

/** 504: a provider did not answer in time. */
export class ProviderTimeout extends Schema.TaggedError<ProviderTimeout>()("ProviderTimeout", {
  provider: Schema.String,
  after: Schema.String
}) {
  override get message(): string {
    return `${this.provider} did not respond within ${this.after}.`;
  }
}

export type ApiFailure =
  | InvalidRequest
  | ResourceNotFound
  | ResourceConflict
  | ProviderNotConfigured
  | ProviderUpstreamError
  | ProviderTimeout;

export interface HttpError {
  readonly status: number;
  readonly body: ApiErrorBody;
  /** True when the failure is ours (5xx other than a provider's) and its cause must be logged. */
  readonly internal: boolean;
}

const internalErrorMessage = "Something went wrong on our side. Quote the request id if you report it.";

function envelope(type: ApiErrorType, code: string, message: string, extra: { param?: string; request_id?: string } = {}): ApiErrorBody {
  return { error: { type, code, message, ...extra } };
}

function mapFailure(error: ApiFailure): Omit<HttpError, "internal"> {
  switch (error._tag) {
    case "InvalidRequest":
      return {
        status: 400,
        body: envelope("invalid_request_error", error.missing ? "parameter_missing" : "parameter_invalid", error.message, error.param ? { param: error.param } : {})
      };
    case "ResourceNotFound":
      return { status: 404, body: envelope("invalid_request_error", "resource_missing", error.message) };
    case "ResourceConflict":
      return { status: 409, body: envelope("invalid_request_error", "resource_conflict", error.message) };
    case "ProviderNotConfigured":
      return { status: 503, body: envelope("api_error", "provider_not_configured", error.message) };
    case "ProviderUpstreamError":
      return { status: 502, body: envelope("api_error", "upstream_error", error.message) };
    case "ProviderTimeout":
      return { status: 504, body: envelope("api_error", "upstream_timeout", error.message) };
  }
}

const apiFailureTags = new Set<string>([
  "InvalidRequest",
  "ResourceNotFound",
  "ResourceConflict",
  "ProviderNotConfigured",
  "ProviderUpstreamError",
  "ProviderTimeout"
]);

function isApiFailure(error: unknown): error is ApiFailure {
  return typeof error === "object" && error !== null && "_tag" in error && apiFailureTags.has(String(error._tag));
}

/**
 * Maps a failed request's Cause to a status and envelope. Typed API failures
 * keep their meaning; anything else (an unexpected error, a defect, a failed
 * runtime) is a 500 that returns only the request id.
 */
export function toHttpError(cause: Cause.Cause<unknown>, requestId: string): HttpError {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure) && isApiFailure(failure.value)) {
    return { ...mapFailure(failure.value), internal: false };
  }
  if (Cause.hasInterruptsOnly(cause)) {
    return {
      status: 499,
      body: envelope("api_error", "request_cancelled", "The request was cancelled.", { request_id: requestId }),
      internal: false
    };
  }
  return {
    status: 500,
    body: envelope("api_error", "internal_error", internalErrorMessage, { request_id: requestId }),
    internal: true
  };
}

/** The first failing path in a Schema decode issue, as a dotted `param`, and whether a key was missing. */
export function issueParam(issue: SchemaIssue.Issue): { param?: string; missing: boolean } {
  const path: Array<PropertyKey> = [];
  let current: SchemaIssue.Issue | undefined = issue;
  while (current) {
    switch (current._tag) {
      case "Pointer":
        path.push(...current.path);
        current = current.issue;
        break;
      case "Composite":
      case "AnyOf":
        current = current.issues[0];
        break;
      case "Filter":
      case "Encoding":
        current = current.issue;
        break;
      case "MissingKey":
        return { missing: true, param: path.length ? path.map(String).join(".") : undefined };
      default:
        return { missing: false, param: path.length ? path.map(String).join(".") : undefined };
    }
  }
  return { missing: false, param: path.length ? path.map(String).join(".") : undefined };
}
