// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const configuration = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock("@/lib/workspace-env", () => ({ readWorkspaceEnv: () => configuration.env }));
import { fetchShopSourceItems, normalizeShopOrders, saveShopSession, shopSessionStatus, ShopSourceError } from "@/lib/shop-source";

let testHome: string;
beforeEach(async () => {
  testHome = await mkdtemp(path.join(os.tmpdir(), "koban-shop-session-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(testHome);
  configuration.env = {};
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(testHome, { recursive: true, force: true });
});

describe("Shop order source", () => {
  it("stores a session privately and reports presence without exposing its value", async () => {
    await expect(shopSessionStatus()).resolves.toEqual({ configured: false, source: "none" });
    await saveShopSession("session=fixture-secret");
    const file = path.join(testHome, ".config", "koban", "shop-session.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ cookie: "session=fixture-secret" });
    await expect(shopSessionStatus()).resolves.toEqual({ configured: true, source: "file" });
    expect(await readdir(path.dirname(file))).toEqual(["shop-session.json"]);
    await expect(saveShopSession("session=x\nheader=y")).rejects.toBeInstanceOf(ShopSourceError);
  });

  it("refuses to save an inactive profile beneath an environment override", async () => {
    configuration.env = { SHOP_COOKIE: "session=environment-fixture" };
    await expect(saveShopSession("session=other-fixture")).rejects.toMatchObject({ code: "config" });
    await expect(shopSessionStatus()).resolves.toEqual({ configured: true, source: "env" });
  });
  it("normalizes orders and delivery wrappers without duplicates", () => {
    const order = fixtureOrder("order-1");
    const items = normalizeShopOrders({
      orders: [order, { __typename: "Delivery", order }]
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      amount: 42.5,
      currency: "USD",
      externalId: "order-1",
      kind: "order",
      merchantName: "Example Store",
      occurredAt: "2026-08-01T12:00:00.000Z",
      sourceId: "source_shop_orders"
    });
    expect(items[0]?.summary).toContain("Items: Canvas bag");
    expect(items[0]?.metadata).toMatchObject({
      items: [{ quantity: 1, title: "Canvas bag" }]
    });
  });

  it("paginates the order-history route and deduplicates wrapped orders", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(orderHistoryPage([fixtureOrder("order-1")], true, "cursor-1")))
      .mockResolvedValueOnce(Response.json(orderHistoryPage([
        { __typename: "Delivery", order: fixtureOrder("order-1") },
        fixtureOrder("order-2")
      ], false, null)));

    const result = await fetchShopSourceItems({
      env: { SHOP_COOKIE: "session=test" },
      fetchImpl
    });

    expect(result).toMatchObject({ hasMore: false });
    expect(result.items.map((item) => item.externalId)).toEqual(["order-1", "order-2"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = fetchImpl.mock.calls[0];
    expect(first?.[0]).toBe("https://shop.app/web/api/order-history");
    expect(first?.[1]).toMatchObject({ method: "POST", redirect: "error" });
    expect(first?.[1]?.headers).toMatchObject({ "user-agent": expect.stringContaining("Mozilla/5.0") });
    expect(JSON.parse(String(first?.[1]?.body))).toEqual({ pageSize: "25" });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({ after: "cursor-1", pageSize: "25" });
  });

  it("reports a capped result without claiming complete history", async () => {
    const result = await fetchShopSourceItems({
      env: { SHOP_COOKIE: "session=test" },
      fetchImpl: async () => Response.json(orderHistoryPage([fixtureOrder("order-1")], true, "more")),
      maxPages: 1
    });
    expect(result.hasMore).toBe(true);
  });

  it("rejects missing sessions, authorization failures, and malformed payloads safely", async () => {
    await expect(fetchShopSourceItems({ env: {} })).rejects.toMatchObject({ code: "auth" });
    await expect(fetchShopSourceItems({
      env: { SHOP_COOKIE: "session=test" },
      fetchImpl: async () => new Response("<html>sign in</html>", { status: 403 })
    })).rejects.toMatchObject({ code: "auth" });
    await expect(fetchShopSourceItems({
      env: { SHOP_COOKIE: "session=test" },
      fetchImpl: async () => Response.json({ data: {} })
    })).rejects.toBeInstanceOf(ShopSourceError);
  });

  it("rejects repeated pagination cursors", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(orderHistoryPage([], true, "same")))
      .mockResolvedValueOnce(Response.json(orderHistoryPage([], true, "same")));
    await expect(fetchShopSourceItems({ env: { SHOP_COOKIE: "session=test" }, fetchImpl }))
      .rejects.toThrow("repeated cursor");
  });

  it("rejects malformed pagination and oversized pages", async () => {
    await expect(fetchShopSourceItems({
      env: { SHOP_COOKIE: "session=test" },
      fetchImpl: async () => Response.json(orderHistoryPage([], "yes" as unknown as boolean, null))
    })).rejects.toThrow("malformed pagination");

    await expect(fetchShopSourceItems({
      env: { SHOP_COOKIE: "session=test" },
      fetchImpl: async () => Response.json(orderHistoryPage(
        Array.from({ length: 26 }, (_, index) => fixtureOrder(`order-${index}`)),
        false,
        null
      ))
    })).rejects.toThrow("too many orders");
  });

  it("does not turn an empty amount into a synthetic zero", () => {
    const order = fixtureOrder("order-empty");
    order.effectiveTotalPrice.amount = "";
    expect(normalizeShopOrders({ orders: [order] })[0]?.amount).toBeUndefined();
  });
});

function orderHistoryPage(nodes: unknown[], hasNextPage: boolean, endCursor: string | null) {
  return { accounts: null, deliveriesOrdersList: { nodes, pageInfo: { endCursor, hasNextPage } }, error: null };
}

function fixtureOrder(id: string) {
  return {
    __typename: "Order",
    createdAt: "2026-08-01T12:00:00Z",
    displayStatus: "Delivered",
    effectiveTotalPrice: { amount: "42.50", currencyCode: "USD" },
    id,
    lineItems: { nodes: [{ productTitle: "Canvas bag", quantity: 1 }] },
    shop: { name: "Example Store" },
    totalItemCount: 1,
    uuid: id
  };
}

describe("Shop rate limiting", () => {
  const env = { SHOP_COOKIE: "session=test" };
  const statePath = () => path.join(testHome, ".config", "koban", "shop-rate-limit.json");
  const throttled = () => Response.json(
    { data: null, errors: [{ extensions: { code: "TOO_MANY_REQUESTS" }, message: "Slow down there partner." }] },
    { status: 429 }
  );

  it("starts a cooldown on a 429 and does not contact Shop again until it ends", async () => {
    let clock = Date.parse("2026-09-24T03:00:00Z");
    const fetchImpl = vi.fn(async () => throttled());

    await expect(fetchShopSourceItems({ env, fetchImpl, now: () => clock })).rejects.toMatchObject({ code: "rate_limited" });
    expect(JSON.parse(await readFile(statePath(), "utf8"))).toEqual({ hits: 1, until: clock + 15 * 60_000 });
    const requestsBeforeCooldown = fetchImpl.mock.calls.length;

    clock += 10 * 60_000;
    await expect(fetchShopSourceItems({ env, fetchImpl, now: () => clock })).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(requestsBeforeCooldown);
  });

  it("treats a GraphQL TOO_MANY_REQUESTS error as throttling, not an auth failure", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: null, errors: [{ extensions: { code: "TOO_MANY_REQUESTS" } }] }));

    await expect(fetchShopSourceItems({ env, fetchImpl })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("honors Retry-After and doubles the cooldown on consecutive hits", async () => {
    let clock = Date.parse("2026-09-24T03:00:00Z");
    const withRetryAfter = vi.fn(async () => new Response("{}", { headers: { "retry-after": "120" }, status: 429 }));
    await expect(fetchShopSourceItems({ env, fetchImpl: withRetryAfter, now: () => clock })).rejects.toMatchObject({ code: "rate_limited" });
    expect(JSON.parse(await readFile(statePath(), "utf8")).until).toBe(clock + 120_000);

    clock += 121_000;
    await expect(fetchShopSourceItems({ env, fetchImpl: vi.fn(async () => throttled()), now: () => clock })).rejects.toMatchObject({ code: "rate_limited" });
    expect(JSON.parse(await readFile(statePath(), "utf8"))).toEqual({ hits: 2, until: clock + 30 * 60_000 });
  });

  it("clears the cooldown after a successful sync", async () => {
    let clock = Date.parse("2026-09-24T03:00:00Z");
    await expect(fetchShopSourceItems({ env, fetchImpl: vi.fn(async () => throttled()), now: () => clock })).rejects.toMatchObject({ code: "rate_limited" });

    clock += 16 * 60_000;
    const result = await fetchShopSourceItems({
      env,
      fetchImpl: vi.fn(async () => Response.json(orderHistoryPage([fixtureOrder("order-1")], false, null))),
      now: () => clock
    });

    expect(result.items).toHaveLength(1);
    await expect(stat(statePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a signed-out session without starting a cooldown", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ accounts: null, deliveriesOrdersList: null, error: "UNAUTHORIZED" }, { status: 401 }));

    await expect(fetchShopSourceItems({ env, fetchImpl })).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("signed out") });
    await expect(stat(statePath())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears an old cooldown when a new session is saved", async () => {
    await expect(fetchShopSourceItems({ env, fetchImpl: vi.fn(async () => throttled()) })).rejects.toMatchObject({ code: "rate_limited" });
    configuration.env = {};

    await saveShopSession("session=fresh");

    await expect(stat(statePath())).rejects.toMatchObject({ code: "ENOENT" });
  });
});
