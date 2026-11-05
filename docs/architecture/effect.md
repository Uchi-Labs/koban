# Effect on the server

Koban's server code is moving onto [Effect](https://effect.website) v4 (`effect` pinned to `4.1.2` in `apps/web/package.json`, the newest stable 4.x on npm when it was pinned in November 2026), one slice at a time. This page holds the rules for code that is already on Effect. It is adapted from t3code's `docs/internals/effect-services.md`.

Example of a request on the new path, `PATCH /api/v1/rules/r_1` with `{"match_operator":"contains"}` on a rule whose pattern is too broad:

```
route.ts      handler({ operation: "Rules.update", params, body }, run)
  decode      params and body; a malformed body is a 400 before `run` starts
  run         validation fails -> InvalidRequest{reason}
  map         toHttpError -> 400 {"error":{"type":"invalid_request_error","code":"parameter_invalid","message":"Contains rule pattern is too broad ..."}}
  headers     x-request-id: req_3f0c...
```

## Where things live

| Path | What |
|---|---|
| `apps/web/lib/effect/runtime.ts` | `appLayer`, the one `ManagedRuntime` per process (stored on `globalThis`), `runApp`, `runServerEffect`, `bootAppRuntime`, `disposeAppRuntime` |
| `apps/web/lib/effect/http.ts` | `handler()` for route handlers, `CurrentRequest`, `fromPromise` for Promise-based code |
| `apps/web/lib/effect/errors.ts` | API failure classes and `toHttpError`, the only place that builds the error envelope |
| `apps/web/lib/api-error-envelope.ts` | Envelope types and `apiErrorMessage`, which the browser uses to read either error shape |
| `apps/web/lib/config/AppConfig.ts` | `AppConfig`: environment read once through `Config`, secrets as `Redacted` |
| `apps/web/lib/security/SecretBox.ts` | AES-256-GCM `seal`/`unseal` keyed by `KOBAN_SECRET_KEY` |
| `apps/web/lib/effect/sync-errors.ts` | Tagged errors for the sync pipeline (`app-sync-service.ts`, `source-adapters.ts`) |

Later slices add `lib/db/` (E2), `lib/providers/` (E5), `lib/sync/` (E6) and `lib/contracts/` (E7) in the same shape.

## Runtime boundary

Effects run only at framework edges: route handlers (through `handler()`), server components and server actions (through loaders that call `runApp`), `instrumentation.ts`, and tests. Services and repositories never call `runPromise`.

- `instrumentation.ts` calls `bootAppRuntime()` before anything else. A bad configuration exits the process with one line naming the setting.
- The runtime lives on `globalThis.__kobanAppRuntime`, because Next can load a module twice (duplicate module graphs, dev hot reload) and both copies must share one runtime and the resources it owns.
- On `SIGTERM` the runtime is disposed. Next's own handler exits the process, so disposal is best effort unless `NEXT_MANUAL_SIG_HANDLE` is set.
- Configuration is read when the runtime is built. Restart the server after changing `.env` or the shell environment.
- `runServerEffect` is the Promise form for code that is not on Effect yet (the sync pipeline). It rejects with the failure.

## Route handlers

```ts
export const PATCH = handler(
  { body: JsonObjectBody, operation: "Goals.update", params: GoalParams },
  ({ body, params }) =>
    Effect.gen(function* () {
      const updated = yield* fromPromise("Goals.update", () => updateFinancialGoal(params.goalId, body));
      if (!updated) return yield* new ResourceNotFound({ id: params.goalId, resource: "Financial goal" });
      return serializeGoal(updated);
    })
);
```

`handler()`:

- decodes `params` and `body` with Schema. `JsonObjectBody` accepts any JSON object, for routes that still validate by hand; E7 replaces it with one request Schema per route.
- provides `CurrentRequest` (request id, method, path).
- runs on the shared runtime with `request.signal`, so a closed connection interrupts the work.
- maps the failure through `toHttpError` and sets `x-request-id` on every response. An incoming `x-request-id` is kept if it is short and plain; otherwise a new `req_<32 hex>` id is made.
- logs internal failures (500) with the request id and the full cause. The response carries only the id.

A handler decodes, calls, and maps errors. Business logic belongs in a service or a domain function, so MCP tools, scheduled syncs and the UI reach the same code.

## Error envelope

Every route on `handler()` answers errors as:

```json
{ "error": { "type": "invalid_request_error", "code": "parameter_invalid", "message": "Budget must be positive.", "param": "budget_amount" } }
```

| Failure | Status | `type` | `code` |
|---|---|---|---|
| `InvalidRequest`, Schema decode failure | 400 | `invalid_request_error` | `parameter_invalid`, or `parameter_missing` (with `param`) |
| `ResourceNotFound` | 404 | `invalid_request_error` | `resource_missing` |
| `ResourceConflict` | 409 | `invalid_request_error` | `resource_conflict` |
| `ProviderNotConfigured` | 503 | `api_error` | `provider_not_configured` |
| `ProviderUpstreamError` | 502 | `api_error` | `upstream_error` (the provider's status is logged, never copied) |
| `ProviderTimeout` | 504 | `api_error` | `upstream_timeout` |
| interrupted (client went away) | 499 | `api_error` | `request_cancelled` |
| anything else | 500 | `api_error` | `internal_error`, with `request_id` |

Routes not yet on `handler()` still answer `{"error": "message"}`. Until every route is ported, readers accept both: the browser through `apiErrorMessage(body, fallback)`, the MCP client through `backendErrorDetail` in `packages/agent-interface/src/client.js`. The proxy's local-only refusal (below) already uses the envelope.

## Service modules

One module per service, in this order: imports, errors and schemas, the `Context.Service` class with its interface inline, `make`, then `layer`.

```ts
export class FooWriteError extends Schema.TaggedError<FooWriteError>()("FooWriteError", {
  path: Schema.String,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return "Failed to write the foo file.";
  }
}

export class Foo extends Context.Service<
  Foo,
  { readonly write: (input: { readonly path: string }) => Effect.Effect<void, FooWriteError> }
>()("koban/area/Foo") {}

const make = Effect.gen(function* () {
  const config = yield* AppConfig;
  const write = Effect.fn("Foo.write")(function* (input: { readonly path: string }) {
    // ...
  });
  return Foo.of({ write });
});

export const layer = Layer.effect(Foo, make);
```

- **Imports.** Effect modules as namespaces from subpaths: `import * as Effect from "effect/Effect"`. A service module is imported as a namespace too: `import * as SecretBox from "@/lib/security/SecretBox"`, then `yield* SecretBox.SecretBox` and `SecretBox.layer`.
- **Dependencies** come from the environment (`yield* AppConfig`), never as parameters to `make` and never from a module global.
- **Functions.** Service operations use `Effect.fn("Service.operation")`, which creates a span. Keep `Effect.gen` for inline programs and layer construction.
- **Wiring.** Every layer is composed in `lib/effect/runtime.ts`. Add a new service to `appLayer` and to `AppServices`.
- **Network calls stay outside write transactions** (E2 enforces this by giving repositories no access to providers).

## Errors

- Failures are `Schema.TaggedError` classes with structured fields. The message is fixed or built from those fields, never from `cause`.
- An error that wraps a lower failure keeps it as `cause` (`Schema.Defect()`).
- Fields stay bounded: no credentials, raw payloads, query strings or provider bodies. The exact value lives only in `cause`, which is logged, not returned.
- Catch known tags with `Effect.catchTags({ ... })`, even for one tag. `Effect.catch` handles the whole channel. Never match on message strings.
- Map to the HTTP envelope only in `toHttpError`. Code below the handler never builds a response body.
- `fromPromise(operation, fn)` wraps Promise-based code (finance-db until E2) as `LegacyCallError`, which is a 500 unless the route maps it. The category routes map it to their existing 400 message because finance-db throws plain `Error`s for bad input; E2's typed repository errors replace that.

## Configuration

`AppConfig` reads through Effect `Config`. The provider is the process environment with the workspace `.env` as a fallback:

- **The shell wins.** A key set in both with different values uses the shell value and logs one warning per key, naming the key and never the value. Before E1, `.env` overrode the shell.
- `readWorkspaceEnv()` keeps the same precedence for code not on Effect (`proxy.ts`, pages) and parses `.env` once per process.
- Secrets are `Redacted`: `DATABASE_URL`, `AI_FINANCES_AUTH_TOKEN`, `KOBAN_SECRET_KEY`, `BETTER_AUTH_SECRET`, `PLAID_SECRET`, `PLAID_SANDBOX_SECRET`, `SIMPLEFIN_ACCESS_URL`, `SNAPTRADE_CONSUMER_KEY`, `SNAPTRADE_USER_SECRET`, `VOYAGE_API_KEY`, `OPENAI_API_KEY`, `AI_FINANCES_LLM_API_KEY`.
- Tests provide config with `ConfigProvider.fromUnknown({...})` instead of mutating `process.env` (see `__tests__/app-config.test.ts`).

The server refuses to boot when:

| Condition | Fix named in the message |
|---|---|
| `KOBAN_PUBLIC_DEMO=1` and `DATABASE_URL` is not a Postgres database whose name contains `demo` | unset the flag or point at the demo database |
| `DATABASE_URL` is set (hosted) and `KOBAN_SECRET_KEY` is not | set `KOBAN_SECRET_KEY` (`openssl rand -base64 32`) |
| `KOBAN_SECRET_KEY` is not 32 bytes of base64 | regenerate it |
| production, local mode, no `AI_FINANCES_AUTH_TOKEN`, and `HOSTNAME` unset or not loopback | set the token, or `HOSTNAME=127.0.0.1` |

## Secrets key

`SecretBox` seals with AES-256-GCM. Sealed values look like `kb1.<iv>.<tag>.<ciphertext>` (base64url parts).

- Hosted mode: `KOBAN_SECRET_KEY` is required.
- Local mode: if `KOBAN_SECRET_KEY` is unset, the first boot writes a random key to `data/local/secret-key` (next to the PGlite store; beside `AI_FINANCES_PGLITE_DIR` when that is set) with mode 0600, and later boots read it. Losing that file makes sealed values unreadable.
- E1 adds only the service. E5 moves Plaid, SnapTrade and ChatGPT tokens onto it.

## Local open mode

With neither `DATABASE_URL` nor `AI_FINANCES_AUTH_TOKEN`, Koban has no sign-in. Verdict: open on loopback, closed off it (system-design F11).

- Production (`next start`, the standalone server, Docker) refuses to boot unless `HOSTNAME` is loopback.
- `next dev` binds every interface by default and does not expose the bind address, so the proxy also refuses any request whose Host is not loopback with 403 `local_only`. A crafted Host header passes that check; it stops browsers on the LAN and DNS rebinding, not a determined client. Set `AI_FINANCES_AUTH_TOKEN` whenever the port is reachable from another machine.

## Tests

- `@effect/vitest` (`it.effect`) for code on Effect; provide layers explicitly.
- Use `TestClock` for timeouts and schedules, never real sleeps. Synchronize with `Deferred`, `Latch` or `Queue`.
- Test layers replace external services. Production code exports no `*ForTests` seams for new services.
- `vitest.setup.ts` sets a random per-process `KOBAN_SECRET_KEY`, so the shared runtime never writes a key file during tests.

## What stays off Effect

React and client code, pure domain functions (`transaction-classification.ts`, `cashflow.ts`, `rule-match.ts`, ...), AI SDK internals, Better Auth internals, the `proxy.ts` auth decision, `packages/agent-interface`, and `packages/schema` types. Next.js owns routing and the process lifecycle, so `effect/http` routers and `NodeRuntime.runMain` are not used.
