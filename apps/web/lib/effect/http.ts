import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { InvalidRequest, issueParam, toHttpError } from "@/lib/effect/errors";
import { runApp, type AppServices } from "@/lib/effect/runtime";
import { AppConfigError } from "@/lib/config/AppConfig";
import { SecretKeyFileError } from "@/lib/security/SecretBox";

/** Per-request facts a handler's effect can read. */
export class CurrentRequest extends Context.Service<
  CurrentRequest,
  {
    readonly requestId: string;
    readonly method: string;
    readonly pathname: string;
  }
>()("koban/http/CurrentRequest") {}

export const requestIdHeader = "x-request-id";

/**
 * A required JSON object body decoded with this Schema; a decode failure is a
 * 400 naming the field. `JsonObjectBody` accepts any object, for routes that
 * still validate by hand until their request Schema lands (E7).
 */
type BodySpec<B> = Schema.Decoder<B>;

export const JsonObjectBody = Schema.Record(Schema.String, Schema.Unknown);

interface HandlerOptions<P, B> {
  /** Span and log name, such as "Categories.update". */
  readonly operation: string;
  readonly params?: Schema.Decoder<P>;
  readonly body?: BodySpec<B>;
  /** Success status; 200 by default. */
  readonly status?: number;
}

interface HandlerInput<P, B> {
  readonly params: P;
  readonly body: B;
  readonly request: Request;
}

type RouteContext = { params: Promise<unknown> };

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function requestIdFor(request: Request): string {
  const incoming = request.headers.get(requestIdHeader)?.trim();
  return incoming && requestIdPattern.test(incoming) ? incoming : `req_${randomUUID().replaceAll("-", "")}`;
}

const readBody = Effect.fn("http.readBody")(function* <B>(request: Request, spec: BodySpec<B>) {
  const text = yield* Effect.promise(() => request.text());
  if (!text.trim()) {
    return yield* new InvalidRequest({ reason: "Request body must be a JSON object." });
  }
  const value = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new InvalidRequest({ reason: "Request body must be valid JSON." })
  });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return yield* new InvalidRequest({ reason: "Request body must be a JSON object." });
  }
  return yield* decode(spec, value);
});

function decode<A>(schema: Schema.Decoder<A>, value: unknown): Effect.Effect<A, InvalidRequest> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) => {
      const { missing, param } = issueParam(error.issue);
      return new InvalidRequest({
        missing,
        param,
        reason: param ? `Invalid value for ${param}.` : "Request is invalid."
      });
    })
  );
}

/**
 * Builds a Next.js route handler that runs `run` on the app runtime.
 *
 * It decodes params and body, provides `CurrentRequest`, interrupts the work
 * when the client disconnects (`request.signal`), maps failures through
 * `toHttpError` into the one error envelope, logs internal failures with the
 * request id, and sets `x-request-id` on every response.
 */
export function handler<A, E = never, P = Record<string, never>, B = undefined>(
  options: HandlerOptions<P, B>,
  run: (input: HandlerInput<P, B>) => Effect.Effect<A, E, AppServices | CurrentRequest>
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    const requestId = requestIdFor(request);
    const pathname = new URL(request.url).pathname;
    const rawParams = context?.params ? await context.params : {};

    const program = Effect.gen(function* () {
      const params = options.params ? yield* decode(options.params, rawParams) : (rawParams as P);
      const body = options.body ? yield* readBody<B>(request, options.body) : (undefined as B);
      return yield* run({ body, params, request });
    }).pipe(
      Effect.withSpan(options.operation),
      Effect.provideService(CurrentRequest, CurrentRequest.of({ method: request.method, pathname, requestId }))
    );

    const exit = await runApp(
      program.pipe(
        Effect.tapCause((cause) => {
          const mapped = toHttpError(cause, requestId);
          return mapped.internal
            ? Effect.logError(`${request.method} ${pathname} failed`, cause)
            : Effect.logDebug(`${request.method} ${pathname} -> ${mapped.status}`);
        }),
        Effect.annotateLogs({ operation: options.operation, request_id: requestId })
      ),
      { signal: request.signal }
    );

    if (Exit.isSuccess(exit)) {
      return withRequestId(NextResponse.json(exit.value, { status: options.status ?? 200 }), requestId);
    }

    const mapped = toHttpError(exit.cause, requestId);
    if (mapped.internal && isRuntimeInitFailure(exit.cause)) {
      // The runtime itself failed to build, so its logger is unavailable.
      console.error(`[${requestId}] ${request.method} ${pathname}: app runtime failed to start`, exit.cause);
    }
    return withRequestId(NextResponse.json(mapped.body, { status: mapped.status }), requestId);
  };
}

const isAppConfigError = Schema.is(AppConfigError);
const isSecretKeyFileError = Schema.is(SecretKeyFileError);

function isRuntimeInitFailure(cause: Cause.Cause<unknown>): boolean {
  const failure = Cause.findErrorOption(cause);
  if (Option.isNone(failure)) return false;
  const error = failure.value;
  return isAppConfigError(error) || isSecretKeyFileError(error) || error instanceof Config.ConfigError;
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(requestIdHeader, requestId);
  return response;
}

/** Wraps a Promise-returning call from code not yet on Effect (finance-db and friends). */
export function fromPromise<A>(operation: string, evaluate: () => Promise<A>): Effect.Effect<A, LegacyCallError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new LegacyCallError({ cause, operation })
  });
}

/** A thrown error from Promise-based code. Unmapped, it is a 500. */
export class LegacyCallError extends Schema.TaggedError<LegacyCallError>()("LegacyCallError", {
  operation: Schema.String,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `${this.operation} failed.`;
  }
}
