// @vitest-environment node

import { describe, expect, it } from "vitest";
import { extractLineItems, normalizeAmazonOrders, normalizeInstacartHistory } from "@/lib/source-adapters";
import { normalizeShopOrders } from "@/lib/shop-source";

describe("itemized lines from context sources", () => {
  it("reads names, quantities, unit prices and totals, converting cents and keeping unpriced lines", () => {
    expect(
      extractLineItems({
        lineItems: [
          { quantity: 2, title: "Oat milk", total: "7.98", unit_price: 3.99 },
          { name: "Bananas", price_cents: 129 },
          { description: "Bag fee" },
          { sku: "no name" }
        ]
      })
    ).toEqual([
      { amount: 7.98, name: "Oat milk", quantity: 2, unitPrice: 3.99 },
      { name: "Bananas", unitPrice: 1.29 },
      { name: "Bag fee" }
    ]);
    expect(extractLineItems({ total: 12 })).toBeUndefined();
  });

  it("itemizes Amazon orders that list their items", () => {
    const [order] = normalizeAmazonOrders([
      {
        items: [{ asin: "B0STROLL", price: 64.18, quantity: 1, title: "Replacement stroller wheel" }],
        orderDate: "2026-10-28",
        orderId: "113-1",
        total: 64.18
      }
    ]);
    expect(order.lines).toEqual([{ name: "Replacement stroller wheel", quantity: 1, sku: "B0STROLL", unitPrice: 64.18 }]);
  });

  it("keeps every product row of an Instacart CSV export as a line of its order", () => {
    const [order] = normalizeInstacartHistory([
      { order_date: "2026-10-30", order_id: "ic_9", price_paid_before_tax: "7.98", product_description: "Oatly oat milk", product_price: "3.99", product_quantity: "2", store_name: "Juniper Market" },
      { order_date: "2026-10-30", order_id: "ic_9", price_paid_before_tax: "2.49", product_description: "Bananas", product_price: "2.49", product_quantity: "1", store_name: "Juniper Market" }
    ]);
    expect(order.amount).toBe(10.47);
    expect(order.lines).toEqual([
      { amount: 7.98, name: "Oatly oat milk", quantity: 2, unitPrice: 3.99 },
      { amount: 2.49, name: "Bananas", quantity: 1, unitPrice: 2.49 }
    ]);
  });

  it("turns Shop order line items into lines", () => {
    const [order] = normalizeShopOrders({
      orders: [
        {
          createdAt: "2026-10-01T10:00:00Z",
          effectiveTotalPrice: { amount: 48, currencyCode: "USD" },
          lineItems: { nodes: [{ productTitle: "Linen shirt", quantity: 1, totalPrice: { amount: 48 }, unitPrice: { amount: 48 } }] },
          shop: { name: "Everlane" },
          uuid: "shop_1"
        }
      ]
    });
    expect(order?.lines).toEqual([{ amount: 48, name: "Linen shirt", quantity: 1, unitPrice: 48 }]);
  });
});
