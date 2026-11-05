// @vitest-environment node

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidRequest, ResourceNotFound } from "@/lib/effect/errors";
import { CurrentRequest, fromPromise, handler, JsonObjectBody } from "@/lib/effect/http";

const ItemParams = Schema.Struct({ itemId: Schema.String });

function call(route: (request: Request, context: { params: Promise<unknown> }) => Promise<Response>, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return route(new Request("http://localhost/api/v1/items/item_1", { method: "PATCH", ...init }), {
    params: Promise.resolve({ itemId: "item_1" })
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handler()", () => {
  it("returns the effect's value as JSON with a generated request id", async () => {
    const route = handler({ operation: "Items.get", params: ItemParams }, ({ params }) =>
      Effect.succeed({ id: params.itemId, object: "item" })
    );

    const response = await call(route, { method: "GET" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "item_1", object: "item" });
    expect(response.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it("keeps a well-formed incoming request id and exposes it to the effect", async () => {
    const route = handler({ operation: "Items.get" }, () =>
      Effect.gen(function* () {
        return { request_id: (yield* CurrentRequest).requestId };
      })
    );

    const response = await call(route, { headers: { "x-request-id": "trace-abc.1" }, method: "GET" });

    expect(response.headers.get("x-request-id")).toBe("trace-abc.1");
    expect(await response.json()).toEqual({ request_id: "trace-abc.1" });
  });

  it("maps InvalidRequest to a 400 envelope", async () => {
    const route = handler({ body: JsonObjectBody, operation: "Items.update" }, () =>
      Effect.fail(new InvalidRequest({ param: "budget_amount", reason: "Budget must be positive." }))
    );

    const response = await call(route, { body: JSON.stringify({ budget_amount: -5 }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "parameter_invalid",
        message: "Budget must be positive.",
        param: "budget_amount",
        type: "invalid_request_error"
      }
    });
  });

  it("maps ResourceNotFound to a 404 envelope", async () => {
    const route = handler({ operation: "Items.get", params: ItemParams }, ({ params }) =>
      Effect.fail(new ResourceNotFound({ id: params.itemId, resource: "Item" }))
    );

    const response = await call(route, { method: "GET" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "resource_missing", message: "Item not found.", type: "invalid_request_error" }
    });
  });

  it("answers malformed and non-object JSON bodies with 400 before running the effect", async () => {
    const run = vi.fn(() => Effect.succeed({ ok: true }));
    const route = handler({ body: JsonObjectBody, operation: "Items.update" }, run);

    const malformed = await call(route, { body: "{" });
    const array = await call(route, { body: "[1]" });
    const empty = await call(route, { body: "" });

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { message: "Request body must be valid JSON.", type: "invalid_request_error" } });
    expect(await array.json()).toMatchObject({ error: { message: "Request body must be a JSON object." } });
    expect(empty.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("names the failing field when a body Schema rejects the request", async () => {
    const route = handler(
      { body: Schema.Struct({ name: Schema.String, sort_order: Schema.Number }), operation: "Items.update" },
      ({ body }) => Effect.succeed(body)
    );

    const wrongType = await call(route, { body: JSON.stringify({ name: "Groceries", sort_order: "first" }) });
    const missing = await call(route, { body: JSON.stringify({ sort_order: 1 }) });

    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toMatchObject({ error: { code: "parameter_invalid", param: "sort_order" } });
    expect(await missing.json()).toMatchObject({ error: { code: "parameter_missing", param: "name" } });
  });

  it("returns 500 with only the request id for an unexpected failure, and logs the cause with that id", async () => {
    const output: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(" "));
      });
    }
    const route = handler({ operation: "Items.update" }, () =>
      fromPromise("Items.update", () => Promise.reject(new Error("connection reset by db.internal")))
    );

    const response = await call(route, { headers: { "x-request-id": "req_trace_500" } });
    const body = (await response.json()) as { error: Record<string, unknown> };

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({ code: "internal_error", request_id: "req_trace_500", type: "api_error" });
    expect(JSON.stringify(body)).not.toContain("db.internal");
    const logged = output.join("\n");
    expect(logged).toContain("req_trace_500");
    expect(logged).toContain("connection reset by db.internal");
  });

  it("interrupts the effect when the client disconnects", async () => {
    const controller = new AbortController();
    let interrupted = false;
    const route = handler({ operation: "Items.slow" }, () =>
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => {
        interrupted = true;
      })))
    );

    const pending = route(new Request("http://localhost/api/v1/items/slow", { signal: controller.signal }), {
      params: Promise.resolve({})
    });
    controller.abort();
    const response = await pending;

    expect(interrupted).toBe(true);
    expect(response.status).toBe(499);
  });
});
