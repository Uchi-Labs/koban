import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryLineItems: vi.fn() }));

vi.mock("@/lib/db/finance-db", () => ({
  lineItemTotal: (line: { amount?: number; quantity?: number; unitPrice?: number }) =>
    line.amount ?? (line.unitPrice === undefined ? undefined : line.unitPrice * (line.quantity ?? 1)),
  queryLineItems: mocks.queryLineItems
}));

import { GET } from "@/app/api/v1/line-items/route";

const get = (query: string) => GET(new NextRequest(`http://localhost/api/v1/line-items${query}`));

describe("GET /api/v1/line-items", () => {
  beforeEach(() => mocks.queryLineItems.mockReset());

  it("rejects a missing q and malformed or inverted dates with deliberate 400s", async () => {
    for (const query of ["", "?q=%20", "?q=oat&from=2026-13-01", "?q=oat&from=2026-10-02&to=2026-10-01"]) {
      const response = await get(query);
      expect(response.status).toBe(400);
      expect((await response.json()).error.type).toBe("invalid_request_error");
    }
    expect(mocks.queryLineItems).not.toHaveBeenCalled();
  });

  it("returns matching lines in a list envelope with the total paid", async () => {
    mocks.queryLineItems.mockResolvedValue({
      currency: "USD",
      matchCount: 2,
      matches: [
        {
          line: { amount: 7.98, name: "Oat milk", quantity: 2, unitPrice: 3.99 },
          sourceItem: { id: "src_1", kind: "grocery_order", merchantName: "Juniper Market", occurredAt: "2026-10-30T17:00:00.000Z", sourceId: "source_instacart", title: "Oat milk, eggs" },
          transaction: { amount: -118.4, date: "2026-10-30", description: "Weekly groceries", id: "txn_1", merchantName: "Juniper Market" }
        }
      ],
      sourceItemCount: 2,
      total: 11.97,
      truncated: true,
      unpricedCount: 0
    });
    const response = await get("?q=oat+milk&from=2026-01-01&limit=1");
    expect(mocks.queryLineItems).toHaveBeenCalledWith({ from: "2026-01-01", limit: 1, query: "oat milk", to: undefined });
    expect(await response.json()).toMatchObject({
      object: "list",
      has_more: true,
      total_paid: 11.97,
      line_count: 2,
      data: [{ object: "line_item", name: "Oat milk", paid: 7.98, quantity: 2, unit_price: 3.99, source_item: { id: "src_1" }, transaction: { id: "txn_1", amount: -118.4 } }]
    });
  });
});
