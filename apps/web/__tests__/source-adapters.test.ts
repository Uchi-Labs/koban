// @vitest-environment node

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { closeFinanceDbForTests, getExternalSourceStates } from "@/lib/db/finance-db";
import { isSourceImportTooLarge, maxSourceImportBytes, sourceImportTooLargeMessage } from "@/lib/source-import-limits";
import {
  buildSourceSetupChecklist,
  formatSourceCommandError,
  inflateSqliteJsonRows,
  importSourceAdapterPayload,
  mergeAdapterStatus,
  normalizeAirbnbWishlist,
  normalizeAmazonOrders,
  normalizeGmailMessages,
  normalizeInstacartHistory,
  normalizeOutlookMessages,
  parseSourceImportContent,
  shouldRetainExistingSourceRecords,
  sourceAdapterDefinitions,
  sourceDiagnosticErrorMessage,
  sourceDiagnosticRefreshMessage,
  summarizeCacheProbeRows,
  summarizeSourceReadiness,
  summarizeSourceSyncResults,
  syncSourceAdapter,
  syncSourceAdapters
} from "@/lib/source-adapters";

const originalPath = process.env.PATH;
let testBinPath: string | null = null;
let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testBinPath) {
    rmSync(testBinPath, { force: true, recursive: true });
    testBinPath = null;
  }
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  process.env.PATH = originalPath;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_TELLER_BACKUP_PATH;
});

describe("source adapter normalization", () => {
  it("uses a mailbox-sized source import limit", () => {
    expect(maxSourceImportBytes).toBe(50 * 1024 * 1024);
    expect(isSourceImportTooLarge(maxSourceImportBytes)).toBe(false);
    expect(isSourceImportTooLarge(maxSourceImportBytes + 1)).toBe(true);
    expect(sourceImportTooLargeMessage()).toBe("Import content must be 50 MB or smaller.");
  });

  it("normalizes Gmail receipt messages into email source items", () => {
    const items = normalizeGmailMessages({
      messages: [
        {
          id: "gmail_1",
          internalDate: "1777629600000",
          payload: {
            headers: [
              { name: "Subject", value: "Your Amazon.com order receipt" },
              { name: "From", value: "Amazon.com <shipment-tracking@amazon.com>" }
            ]
          },
          snippet: "Order total: $42.10"
        }
      ]
    });

    expect(items[0]).toMatchObject({
      externalId: "gmail_1",
      kind: "email",
      merchantName: "Amazon.com",
      occurredAt: "2026-05-01T10:00:00.000Z",
      summary: "From: Amazon.com <shipment-tracking@amazon.com>. Order total: $42.10",
      title: "Your Amazon.com order receipt"
    });
  });

  it("normalizes Amazon order rows into order source items", () => {
    const items = normalizeAmazonOrders([
      {
        items: [{ title: "USB-C cable" }, { title: "Laptop stand" }],
        orderId: "111-2222222-3333333",
        placedDate: "2026-05-20",
        status: "Delivered",
        total: "$64.20"
      }
    ]);

    expect(items[0]).toMatchObject({
      amount: 64.2,
      externalId: "111-2222222-3333333",
      kind: "order",
      merchantName: "Amazon",
      occurredAt: "2026-05-20",
      summary: "Order: 111-2222222-3333333. Status: Delivered. Total: 64.2. Items: USB-C cable, Laptop stand",
      title: "USB-C cable, Laptop stand"
    });
  });

  it("normalizes Amazon CSV order exports into order source items", () => {
    const payload = parseSourceImportContent(
      [
        "order id,order url,items,to,date,total,shipping,tax,payments",
        "112-3573634-0352200,https://www.amazon.com/order,\"3M Tape; Lodge Silicone Hot Handle Holder; \",Example Person,2026-04-01,68.34,0,3.16,Amazon Visa ending in 8124;"
      ].join("\n")
    );
    const items = normalizeAmazonOrders(payload);

    expect(items[0]).toMatchObject({
      amount: 68.34,
      externalId: "112-3573634-0352200",
      kind: "order",
      merchantName: "Amazon",
      occurredAt: "2026-04-01",
      summary: "Order: 112-3573634-0352200. Total: 68.34. Items: 3M Tape, Lodge Silicone Hot Handle Holder",
      title: "3M Tape, Lodge Silicone Hot Handle Holder"
    });
    expect(items[0].metadata).toMatchObject({
      order_id: "112-3573634-0352200",
      payments: "Amazon Visa ending in 8124;"
    });
  });

  it("ignores Amazon cache wrapper rows that do not contain usable order evidence", () => {
    expect(
      normalizeAmazonOrders([
        {
          id: "resource_without_order_details",
          resource_type: "amazon_page"
        }
      ])
    ).toEqual([]);
  });

  it("normalizes Instacart purchase history items into grocery source items", () => {
    const items = normalizeInstacartHistory({
      data: {
        items: [
          {
            id: "item_1",
            in_stock: true,
            last_purchased_at: "2026-05-01T12:00:00Z",
            name: "Organic Bananas",
            purchase_count: 4,
            retailer_slug: "costco",
            unit_price: "3.49"
          }
        ]
      }
    });

    expect(items[0]).toMatchObject({
      externalId: "item_1",
      kind: "grocery_order",
      merchantName: "costco",
      occurredAt: "2026-05-01T12:00:00.000Z",
      summary: "Retailer: costco. Purchases: 4. Last purchased: 2026-05-01T12:00:00.000Z",
      title: "Organic Bananas"
    });
    expect(items[0].amount).toBe(3.49);
  });

  it("normalizes Instacart order backfill rows into grocery order evidence", () => {
    const items = normalizeInstacartHistory([
      {
        delivered_at: "2026-04-18T15:31:54Z",
        item_count: 2,
        items: [
          { item_id: "items_42-111", name: "Test Sorbet", price_cents: 899, quantity: 1 },
          { item_id: "items_42-222", name: "Oat Milk", price_cents: 549, quantity: 2 }
        ],
        order_id: "ord-1",
        retailer_name: "QFC",
        retailer_slug: "qfc",
        total_cents: 1448
      }
    ]);

    expect(items[0]).toMatchObject({
      amount: 14.48,
      externalId: "ord-1",
      kind: "grocery_order",
      merchantName: "qfc",
      occurredAt: "2026-04-18T15:31:54.000Z",
      summary: "Retailer: qfc. Order: ord-1. Delivered: 2026-04-18T15:31:54.000Z. Items: 2. Total: 14.48. Products: Test Sorbet, Oat Milk",
      title: "Test Sorbet, Oat Milk"
    });
    expect(items[0].metadata).toMatchObject({
      itemTitles: ["Test Sorbet", "Oat Milk"],
      retailer_name: "QFC"
    });
  });

  it("normalizes Instacart order cache rows with JSON item arrays", () => {
    const items = normalizeInstacartHistory([
      {
        id: "cache_order_1",
        item_count: 1,
        items: JSON.stringify([{ item_id: "item_cache", name: "Organic Blueberries", price_cents: 799 }]),
        placed_at: "2026-05-01 12:00:00",
        retailer_slug: "costco",
        total_cents: 799
      }
    ]);

    expect(items[0]).toMatchObject({
      amount: 7.99,
      externalId: "cache_order_1",
      merchantName: "costco",
      title: "Organic Blueberries"
    });
  });

  it("normalizes Instacart CSV purchased-item exports into grouped grocery orders", () => {
    const payload = parseSourceImportContent(
      [
        "Product Order Type,Order Date,Order ID,Payment Methods,Product Description,Product Quantity,Store Name,Product Price,Price Paid (Before-Tax),Currency",
        "Delivered,\"Mar 31, 2026\",\"'19715679766434764\",Visa 7238,Organic Tomatoes,2,target,7.98,7.98,USD",
        "Delivered,\"Mar 31, 2026\",\"'19715679766434764\",Visa 7238,Blueberries,1,target,5.99,5.99,USD"
      ].join("\n")
    );
    const items = normalizeInstacartHistory(payload);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      amount: 13.97,
      currency: "USD",
      externalId: "19715679766434764",
      kind: "grocery_order",
      merchantName: "target",
      occurredAt: "2026-03-31T04:00:00.000Z",
      summary: "Retailer: target. Order: 19715679766434764. Delivered: 2026-03-31T04:00:00.000Z. Status: Delivered. Items: 3. Item total: 13.97. Products: Organic Tomatoes, Blueberries",
      title: "Organic Tomatoes, Blueberries"
    });
    expect(items[0].metadata).toMatchObject({
      itemCount: 3,
      itemTitles: ["Organic Tomatoes", "Blueberries"],
      paymentMethods: "Visa 7238"
    });
  });

  it("normalizes Instacart CSV order-summary exports after a report preamble", () => {
    const payload = parseSourceImportContent(
      [
        "Platform ,INSTACART",
        "Period ,Last 30 Days Order Report,",
        "",
        "Order Type,Order ID,Order Date,No. of Items,Payment Methods,Currency,Grand Total,Purchased Item Description,Order URL,Shipping Address,Store Name",
        "Delivered,\"'19637281555423008\",\"Mar 22, 2026\",5,Visa 7238,USD,77.25,See Sheet 2 (Purchased Items) for item titles and descriptions.,https://www.instacart.com/store/orders/0322,Example Address,target"
      ].join("\n")
    );
    const items = normalizeInstacartHistory(payload);

    expect(items[0]).toMatchObject({
      amount: 77.25,
      currency: "USD",
      externalId: "19637281555423008",
      merchantName: "target",
      occurredAt: "2026-03-22T04:00:00.000Z",
      summary: "Retailer: target. Order: 19637281555423008. Delivered: 2026-03-22T04:00:00.000Z. Status: Delivered. Items: 5. Total: 77.25",
      title: "Instacart order 19637281555423008"
    });
  });

  it("normalizes Outlook message lists without storing full mail bodies", () => {
    const items = normalizeOutlookMessages({
      value: [
        {
          bodyPreview: "Your ride receipt is ready",
          from: {
            emailAddress: {
              address: "receipts@example.com",
              name: "Receipts"
            }
          },
          amount: "$18.42",
          id: "message_1",
          receivedDateTime: "2026-05-02T14:30:00Z",
          subject: "Receipt from Uber"
        }
      ]
    });

    expect(items[0]).toMatchObject({
      externalId: "message_1",
      kind: "email",
      merchantName: "Receipts",
      occurredAt: "2026-05-02T14:30:00.000Z",
      summary: "From: Receipts. Your ride receipt is ready",
      title: "Receipt from Uber"
    });
    expect(items[0].amount).toBe(18.42);
    expect(items[0].currency).toBe("USD");
    expect(items[0].metadata).toEqual({});
  });

  it("extracts receipt amounts from Gmail and Outlook preview text", () => {
    const gmailItems = normalizeGmailMessages({
      messages: [
        {
          id: "gmail_preview_amount",
          payload: {
            headers: [
              { name: "Subject", value: "Your delivery receipt" },
              { name: "From", value: "Grocery Store <receipts@example.com>" }
            ]
          },
          snippet: "Subtotal $12.50. Total $14.73."
        }
      ]
    });
    const outlookItems = normalizeOutlookMessages({
      value: [
        {
          bodyPreview: "Your trip is complete. Amount charged USD 18.42.",
          id: "outlook_preview_amount",
          receivedDateTime: "2026-05-02T14:30:00Z",
          sender: "Ride Receipts",
          subject: "Receipt from Lyft"
        }
      ]
    });

    expect(gmailItems[0].amount).toBe(14.73);
    expect(gmailItems[0].currency).toBe("USD");
    expect(outlookItems[0].amount).toBe(18.42);
    expect(outlookItems[0].currency).toBe("USD");
  });

  it("preserves source-provided currency codes instead of hardcoding source amounts to USD", () => {
    const gmailItems = normalizeGmailMessages({
      messages: [
        {
          amount: "CAD 18.42",
          id: "gmail_cad",
          payload: {
            headers: [
              { name: "Subject", value: "Your receipt" },
              { name: "From", value: "Canadian Store <receipts@example.ca>" }
            ]
          }
        }
      ]
    });
    const amazonItems = normalizeAmazonOrders([
      {
        currency_code: "eur",
        orderId: "order_eur",
        orderTotal: {
          amount: "64.20",
          currency: "EUR"
        }
      }
    ]);
    const instacartItems = normalizeInstacartHistory([
      {
        currencyCode: "GBP",
        id: "instacart_gbp",
        name: "Tea",
        unit_price: 4.75
      }
    ]);

    expect(gmailItems[0]).toMatchObject({
      amount: 18.42,
      currency: "CAD"
    });
    expect(amazonItems[0]).toMatchObject({
      amount: 64.2,
      currency: "EUR"
    });
    expect(instacartItems[0]).toMatchObject({
      amount: 4.75,
      currency: "GBP"
    });
  });

  it("leaves source currency empty when no source currency is provided", () => {
    const items = normalizeInstacartHistory([
      {
        id: "instacart_unknown_currency",
        name: "Apples",
        unit_price: 3.49
      }
    ]);

    expect(items[0].amount).toBe(3.49);
    expect(items[0].currency).toBeUndefined();
  });

  it("does not treat item counts in receipt previews as amounts", () => {
    const items = normalizeOutlookMessages({
      value: [
        {
          bodyPreview: "Your order total 2 items and ships tomorrow.",
          id: "outlook_item_count",
          sender: "Store Receipts",
          subject: "Order confirmation"
        }
      ]
    });

    expect(items[0].amount).toBeUndefined();
    expect(items[0].currency).toBeUndefined();
  });

  it("normalizes Airbnb wishlist rows into travel context source items", () => {
    const items = normalizeAirbnbWishlist({
      data: [
        {
          after: {
            price: "$212.40"
          },
          direct: {
            url: "https://direct.example/listing_1"
          },
          listing: {
            city: "Austin",
            id: "listing_1",
            title: "Downtown loft",
            url: "https://www.airbnb.com/rooms/listing_1"
          }
        }
      ]
    });

    expect(items[0]).toMatchObject({
      amount: 212.4,
      externalId: "listing_1",
      kind: "travel_listing",
      merchantName: "Airbnb",
      summary: "Location: Austin. Price: 212.4. URL: https://www.airbnb.com/rooms/listing_1. Direct URL: https://direct.example/listing_1",
      title: "Downtown loft"
    });
  });

  it("normalizes Airbnb reservation CSV exports into travel booking evidence", () => {
    const payload = parseSourceImportContent(
      [
        "confirmation code,listing,city,check in,check out,total,currency,status,host,nights,reservation url",
        "HMABC123,Downtown loft,Austin,2026-06-10,2026-06-14,1047.25,USD,Confirmed,Jane,4,https://www.airbnb.com/trips/v1/HMABC123"
      ].join("\n")
    );
    const items = normalizeAirbnbWishlist(payload);

    expect(items[0]).toMatchObject({
      amount: 1047.25,
      currency: "USD",
      externalId: "HMABC123",
      kind: "travel_booking",
      merchantName: "Airbnb",
      occurredAt: "2026-06-10",
      summary: "Location: Austin. Check-in: 2026-06-10. Check-out: 2026-06-14. Nights: 4. Status: Confirmed. Total: 1047.25. Host: Jane. URL: https://www.airbnb.com/trips/v1/HMABC123",
      title: "Downtown loft"
    });
  });

  it("normalizes Airbnb watchlist and price snapshot cache rows", () => {
    const watchItems = normalizeAirbnbWishlist([
      {
        added_at: 1777629600,
        checkin: "2026-06-10",
        checkout: "2026-06-14",
        id: "watch_1",
        last_checked_at: 1777716000,
        last_price: 780.25,
        listing_id: "37124493",
        listing_url: "https://www.airbnb.com/rooms/37124493",
        max_price: 900,
        platform: "airbnb"
      }
    ]);
    const snapshotItems = normalizeAirbnbWishlist([
      {
        checkin: "2026-06-10",
        checkout: "2026-06-14",
        cleaning_fee: 85,
        id: "price:airbnb:37124493:1777716000",
        listing_id: "37124493",
        platform: "airbnb",
        service_fee: 90,
        snapshot_at: 1777716000,
        tax: 72,
        total_price: 1047.25
      }
    ]);

    expect(watchItems[0]).toMatchObject({
      amount: 780.25,
      externalId: "watch_1",
      merchantName: "Airbnb",
      occurredAt: "2026-05-02T10:00:00.000Z",
      summary: "Platform: airbnb. Check-in: 2026-06-10. Check-out: 2026-06-14. Price: 780.25. URL: https://www.airbnb.com/rooms/37124493",
      title: "Airbnb listing 37124493"
    });
    expect(snapshotItems[0]).toMatchObject({
      amount: 1047.25,
      externalId: "price:airbnb:37124493:1777716000",
      merchantName: "Airbnb",
      occurredAt: "2026-05-02T10:00:00.000Z",
      title: "Airbnb listing 37124493"
    });
    expect(snapshotItems[0].metadata).toMatchObject({
      cleaning_fee: 85,
      service_fee: 90,
      tax: 72
    });
  });

  it("inflates local SQLite JSON cache rows without storing wrapper metadata as content", () => {
    const rows = inflateSqliteJsonRows([
      {
        data: JSON.stringify({
          listing: {
            city: "Austin",
            id: "listing_2",
            title: "Garden casita"
          },
          price: "$180.00"
        }),
        id: "cache_listing_2",
        resource_type: "airbnb_listing"
      }
    ]);
    const items = normalizeAirbnbWishlist(rows);

    expect(rows[0]).toMatchObject({
      id: "cache_listing_2",
      listing: {
        title: "Garden casita"
      },
      resource_type: "airbnb_listing"
    });
    expect(items[0]).toMatchObject({
      amount: 180,
      externalId: "cache_listing_2",
      title: "Garden casita"
    });
  });

  it("normalizes local cache row shapes from Instacart and Outlook", () => {
    const instacartItems = normalizeInstacartHistory([
      {
        id: "item_cache_1",
        in_stock: 1,
        last_purchased_at: "2026-05-01 12:00:00",
        name: "Organic Blueberries",
        purchase_count: 3,
        retailer_slug: "costco",
        unit_price: 7.99
      }
    ]);
    const outlookItems = normalizeOutlookMessages([
      {
        bodyPreview: "Receipt total $22.18",
        conversation_id: "conversation_cache_1",
        has_attachments: 1,
        id: "message_cache_1",
        received_date_time: "2026-05-03T10:30:00Z",
        sender: "Coffee Shop <receipts@coffee.example>",
        subject: "Your receipt",
        web_link: "https://outlook.office.com/mail/message_cache_1"
      }
    ]);

    expect(instacartItems[0]).toMatchObject({
      amount: 7.99,
      externalId: "item_cache_1",
      merchantName: "costco",
      title: "Organic Blueberries"
    });
    expect(outlookItems[0]).toMatchObject({
      externalId: "message_cache_1",
      merchantName: "Coffee Shop",
      occurredAt: "2026-05-03T10:30:00.000Z",
      summary: "From: Coffee Shop <receipts@coffee.example>. Receipt total $22.18",
      title: "Your receipt"
    });
    expect(outlookItems[0].metadata).toMatchObject({
      conversation_id: "conversation_cache_1",
      has_attachments: 1,
      web_link: "https://outlook.office.com/mail/message_cache_1"
    });
  });

  it("normalizes Outlook generic resource cache rows", () => {
    const rows = inflateSqliteJsonRows([
      {
        data: JSON.stringify({
          bodyPreview: "Your order total was $31.20.",
          from: {
            emailAddress: {
              address: "orders@example.com",
              name: "Example Store"
            }
          },
          receivedDateTime: "2026-05-04T16:45:00Z",
          subject: "Order confirmation"
        }),
        id: "resource_message_1",
        resource_type: "outlook_message",
        synced_at: "2026-05-04T17:00:00Z"
      }
    ]);
    const items = normalizeOutlookMessages(rows);

    expect(items[0]).toMatchObject({
      amount: 31.2,
      externalId: "resource_message_1",
      kind: "email",
      merchantName: "Example Store",
      occurredAt: "2026-05-04T16:45:00.000Z",
      summary: "From: Example Store. Your order total was $31.20.",
      title: "Order confirmation"
    });
    expect(items[0].metadata).toMatchObject({
      resource_type: "outlook_message",
      synced_at: "2026-05-04T17:00:00Z"
    });
  });

  it("parses JSON, JSONL, CSV, EML, MBOX, and ICS source import content", () => {
    expect(parseSourceImportContent('[{"id":"one"}]')).toEqual([{ id: "one" }]);
    expect(parseSourceImportContent('{"id":"one"}\n{"id":"two"}')).toEqual([{ id: "one" }, { id: "two" }]);
    expect(parseSourceImportContent("Order ID,Order Date,Grand Total\n'abc,2026-03-31,42.10")).toEqual([
      expect.objectContaining({
        grandTotal: "42.10",
        grand_total: "42.10",
        orderId: "abc",
        order_id: "abc"
      })
    ]);

    expect(
      parseSourceImportContent(
        [
          "Subject: Lyft ride receipt",
          "From: Lyft Receipts <receipts@lyftmail.com>",
          "Date: Mon, 04 May 2026 16:45:00 -0000",
          "Message-ID: <lyft-1@example.com>",
          "",
          "Thanks for riding. Total paid: $24.18"
        ].join("\n")
      )
    ).toEqual([
      expect.objectContaining({
        bodyPreview: "Thanks for riding. Total paid: $24.18",
        from: "Lyft Receipts <receipts@lyftmail.com>",
        message_id: "<lyft-1@example.com>",
        subject: "Lyft ride receipt"
      })
    ]);

    expect(
      parseSourceImportContent(
        [
          "From receipts@example.com Mon May 04 16:45:00 2026",
          "Subject: Hotel invoice",
          "From: Hotel Receipts <billing@example.com>",
          "Date: Mon, 04 May 2026 16:45:00 -0000",
          "",
          "Invoice total $128.90",
          "From receipts@example.com Tue May 05 16:45:00 2026",
          "Subject: Grocery order",
          "From: Grocery <orders@example.com>",
          "Date: Tue, 05 May 2026 16:45:00 -0000",
          "",
          "Order total $45.67"
        ].join("\n")
      )
    ).toHaveLength(2);
    expect(
      parseSourceImportContent(
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "BEGIN:VEVENT",
          "UID:airbnb-trip-1",
          "DTSTART;VALUE=DATE:20260610",
          "DTEND;VALUE=DATE:20260614",
          "SUMMARY:Airbnb reservation: Downtown loft",
          "DESCRIPTION:Confirmation code: HMABC123\\nTrip receipt total $1047.25",
          "LOCATION:Austin, TX",
          "URL:https://www.airbnb.com/trips/v1/HMABC123",
          "END:VEVENT",
          "END:VCALENDAR"
        ].join("\n")
      )
    ).toEqual([
      expect.objectContaining({
        confirmation_code: "HMABC123",
        date: "2026-06-10",
        end: "2026-06-14",
        id: "airbnb-trip-1",
        location: "Austin, TX",
        source_format: "ical",
        subject: "Airbnb reservation: Downtown loft"
      })
    ]);
    expect(
      parseSourceImportContent(createStoredZipBase64("calendar.ics", airbnbIcsFixture()), {
        contentEncoding: "base64",
        filename: "calendar.zip"
      })
    ).toEqual([
      expect.objectContaining({
        confirmation_code: "HMABC123",
        id: "airbnb-trip-1",
        source_format: "ical",
        subject: "Airbnb reservation: Downtown loft"
      })
    ]);
    expect(
      parseSourceImportContent(createDeflatedZipBase64("calendar.ics", airbnbIcsFixture(), airbnbIcsFixture().length), {
        contentEncoding: "base64",
        filename: "calendar.zip"
      })
    ).toEqual([
      expect.objectContaining({
        confirmation_code: "HMABC123",
        id: "airbnb-trip-1",
        source_format: "ical",
        subject: "Airbnb reservation: Downtown loft"
      })
    ]);
    expect(() => parseSourceImportContent('{"id":')).toThrow("line 1");
  });

  it("rejects ZIP entries whose inflated content exceeds the import limit despite a small declared size", () => {
    const inflatedPayload = Buffer.alloc(maxSourceImportBytes * 2, 0x61);
    const payload = createDeflatedZipBase64("orders.json", inflatedPayload, 1024);

    expect(() =>
      parseSourceImportContent(payload, {
        contentEncoding: "base64",
        filename: "orders.zip"
      })
    ).toThrow("ZIP import extracted content must be 50 MB or smaller.");
  });

  it("normalizes ICS calendar exports into calendar and travel evidence", () => {
    const payload = parseSourceImportContent(airbnbIcsFixture());

    expect(normalizeGmailMessages(payload)[0]).toMatchObject({
      amount: 1047.25,
      currency: "USD",
      externalId: "airbnb-trip-1",
      kind: "calendar_event",
      merchantName: "Airbnb",
      occurredAt: "2026-06-10",
      summary: "Location: Austin, TX. Starts: 2026-06-10. Ends: 2026-06-14. Status: CONFIRMED. Total: 1047.25. Confirmation code: HMABC123 Trip receipt total $1047.25. URL: https://www.airbnb.com/trips/v1/HMABC123",
      title: "Airbnb reservation: Downtown loft"
    });
    expect(normalizeAirbnbWishlist(payload)[0]).toMatchObject({
      amount: 1047.25,
      currency: "USD",
      externalId: "HMABC123",
      kind: "travel_booking",
      merchantName: "Airbnb",
      occurredAt: "2026-06-10",
      title: "Airbnb reservation: Downtown loft"
    });
  });

  it("ignores generic calendar exports that do not contain finance context", () => {
    const payload = parseSourceImportContent(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:calendar-noise-1",
        "DTSTART:20260610T150000Z",
        "DTEND:20260610T153000Z",
        "SUMMARY:Dentist appointment",
        "DESCRIPTION:Bring insurance forms",
        "LOCATION:Austin, TX",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\n")
    );

    expect(normalizeGmailMessages(payload)).toEqual([]);
    expect(normalizeOutlookMessages(payload)).toEqual([]);
    expect(normalizeAirbnbWishlist(payload)).toEqual([]);
  });

  it("normalizes EML and MBOX email exports into Gmail and Outlook source items", () => {
    const payload = parseSourceImportContent(
      [
        "From receipts@example.com Mon May 04 16:45:00 2026",
        "Subject: Airbnb receipt",
        "From: Airbnb <automated@airbnb.com>",
        "Date: Mon, 04 May 2026 16:45:00 -0000",
        "Message-ID: <airbnb-1@example.com>",
        "",
        "Trip receipt total $312.44"
      ].join("\n")
    );

    expect(normalizeGmailMessages(payload)[0]).toMatchObject({
      amount: 312.44,
      externalId: "<airbnb-1@example.com>",
      kind: "email",
      merchantName: "Airbnb",
      occurredAt: "2026-05-04T16:45:00.000Z",
      summary: "From: Airbnb <automated@airbnb.com>. Trip receipt total $312.44",
      title: "Airbnb receipt"
    });
    expect(normalizeOutlookMessages(payload)[0]).toMatchObject({
      amount: 312.44,
      externalId: "<airbnb-1@example.com>",
      kind: "email",
      merchantName: "Airbnb",
      occurredAt: "2026-05-04T16:45:00.000Z",
      title: "Airbnb receipt"
    });
  });

  it("counts stale source syncs separately from hard errors", () => {
    expect(
      summarizeSourceSyncResults([
        {
          evidenceLinksSuggested: 2,
          itemsWritten: 4,
          runStatus: "succeeded",
          sourceStatus: "connected"
        },
        {
          evidenceLinksSuggested: 0,
          itemsWritten: 0,
          runStatus: "succeeded",
          sourceStatus: "stale"
        },
        {
          evidenceLinksSuggested: 0,
          itemsWritten: 0,
          runStatus: "error",
          sourceStatus: "error"
        },
        {
          evidenceLinksSuggested: 0,
          itemsWritten: 0,
          runStatus: "partial",
          sourceStatus: "connected"
        }
      ])
    ).toEqual({
      evidenceLinksSuggested: 2,
      itemsWritten: 4,
      sourcesAttempted: 4,
      sourcesErrored: 1,
      sourcesPartial: 1,
      sourcesStale: 1
    });
  });

  it("records cached-source refresh failures as partial while keeping imported records usable", async () => {
    useTempDb();
    useFakeCommand("gog", "refresh exploded");
    await importSourceAdapterPayload("source_gmail", {
      content: JSON.stringify({
        messages: [
          {
            id: "gmail_cached_1",
            internalDate: "1777629600000",
            payload: {
              headers: [
                { name: "Subject", value: "Cached receipt" },
                { name: "From", value: "Receipts <receipts@example.com>" }
              ]
            },
            snippet: "Order total: $18.20"
          }
        ]
      })
    });

    const result = await syncSourceAdapter("source_gmail");
    const state = (await getExternalSourceStates()).get("source_gmail");

    expect(result).toMatchObject({
      itemsSeen: 0,
      itemsWritten: 0,
      runStatus: "partial",
      sourceStatus: "connected"
    });
    expect(result.errorMessage).toContain(
      "Source refresh failed for Gmail receipts; using 1 existing imported local records. refresh exploded"
    );
    expect(result.adapter).toMatchObject({
      errorMessage: undefined,
      refreshMessage: result.errorMessage,
      status: "connected"
    });
    expect(state).toMatchObject({
      errorMessage: result.errorMessage,
      status: "connected"
    });
  }, 15_000);

  it("retries a transient source adapter refresh failure once", async () => {
    useTempDb();
    const counterPath = useFlakyJsonCommand(
      "gog",
      JSON.stringify({
        messages: [
          {
            id: "gmail_retry_1",
            internalDate: "1777629600000",
            payload: {
              headers: [
                { name: "Subject", value: "Retry receipt" },
                { name: "From", value: "Receipts <receipts@example.com>" }
              ]
            },
            snippet: "Order total: $18.20"
          }
        ]
      }),
      "transient gmail refresh failure"
    );

    const result = await syncSourceAdapters(["source_gmail"]);

    expect(readFileSync(counterPath, "utf8").trim()).toBe("2");
    expect(result).toMatchObject({
      object: "source_sync_run_list",
      summary: {
        itemsWritten: 1,
        sourcesAttempted: 1,
        sourcesErrored: 0
      }
    });
    expect(result.data[0]).toMatchObject({
      itemsSeen: 1,
      itemsWritten: 1,
      runStatus: "succeeded",
      sourceStatus: "connected"
    });
  }, 15_000);

  it("maps raw Airbnb cookie/config failures to an actionable auth message", () => {
    expect(
      formatSourceCommandError({
        stderr:
          "Error: no cookie file at /Users/vish/.config/airbnb-pp-cli/cookies.json: open /Users/vish/.config/airbnb-pp-cli/config.toml: no such file or directory"
      })
    ).toBe("Airbnb is not authenticated. Run airbnb-pp-cli auth login --chrome, then retry sync.");
  });

  it("summarizes sanitized local CLI cache counts without source contents", () => {
    expect(
      summarizeCacheProbeRows([
        { count: 0, label: "orders" },
        { count: 12, label: "purchased items" }
      ])
    ).toBe("0 orders, 12 purchased items");
  });

  it("retains imported source records when a refresh returns no new rows", () => {
    expect(shouldRetainExistingSourceRecords({ items: [], sourceStatus: "stale" }, { sourceItemCount: 3 })).toBe(true);
    expect(shouldRetainExistingSourceRecords({ items: [], sourceStatus: "stale" }, { sourceItemCount: 0 })).toBe(false);
    expect(shouldRetainExistingSourceRecords({ items: [{}], sourceStatus: "stale" }, { sourceItemCount: 3 })).toBe(false);
    expect(shouldRetainExistingSourceRecords({ items: [], sourceStatus: "connected" }, { sourceItemCount: 3 })).toBe(
      false
    );
  });

  it("keeps imported-ready sources connected in diagnostics even when refresh auth is missing", () => {
    expect(mergeAdapterStatus("connected", "not_configured", { sourceItemCount: 3 })).toBe("connected");
    expect(mergeAdapterStatus("connected", "error", { sourceItemCount: 3 })).toBe("connected");
    expect(mergeAdapterStatus("connected", "not_configured", { sourceItemCount: 0 })).toBe("not_configured");
    expect(mergeAdapterStatus(undefined, "not_configured", { sourceItemCount: 3 })).toBe("not_configured");
  });

  it("does not surface refresh auth errors as current errors for connected imported-ready sources", () => {
    expect(sourceDiagnosticErrorMessage({
      authErrorMessage: "Amazon orders is not authenticated.",
      installed: true,
      setupReady: true,
      stateErrorMessage: "Previous refresh failed.",
      status: "connected"
    })).toBeUndefined();
    expect(sourceDiagnosticErrorMessage({
      authErrorMessage: "Gmail is not authenticated.",
      installed: true,
      setupReady: false,
      status: "not_configured"
    })).toBe("Gmail is not authenticated.");
    expect(sourceDiagnosticErrorMessage({
      installed: false,
      setupReady: false,
      stateErrorMessage: "Previous refresh failed.",
      status: "not_configured"
    })).toBeUndefined();
    expect(sourceDiagnosticRefreshMessage({
      authErrorMessage: "Amazon orders is not authenticated.",
      installed: true,
      setupReady: true,
      stateErrorMessage: "Previous refresh failed.",
      status: "connected"
    })).toBe("Automatic refresh needs attention: Amazon orders is not authenticated.");
    expect(sourceDiagnosticRefreshMessage({
      authErrorMessage: "Amazon orders is not authenticated.",
      installed: true,
      setupReady: false,
      status: "not_configured"
    })).toBeUndefined();
  });

  it("builds machine-readable source setup checklists", () => {
    const gmail = sourceAdapterDefinitions.find((adapter) => adapter.id === "source_gmail")!;
    const gmailSetup = buildSourceSetupChecklist(gmail, true, "not_configured", { sourceItemCount: 0 });

    expect(gmailSetup).toMatchObject({
      nextAction: "Run gog login <email> --readonly --services=gmail,calendar --gmail-no-send.",
      ready: false
    });
    expect(gmailSetup.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "gog login <email> --readonly --services=gmail,calendar --gmail-no-send",
          kind: "auth"
        })
      ])
    );

    const instacart = sourceAdapterDefinitions.find((adapter) => adapter.id === "source_instacart")!;
    const missingInstall = buildSourceSetupChecklist(instacart, false, "not_configured", { sourceItemCount: 0 });

    expect(missingInstall).toMatchObject({
      nextAction: "Install instacart-pp-cli.",
      ready: false
    });
    expect(missingInstall.commands[0]).toMatchObject({
      command: "npx -y @mvanhorn/printing-press-library install instacart --cli-only",
      kind: "install"
    });
    expect(buildSourceSetupChecklist(instacart, true, "not_configured", { sourceItemCount: 0 })).toMatchObject({
      missing: [
        "Authenticate the source account.",
        "Backfill Instacart order history or import a real Instacart JSONL/CSV order dump."
      ],
      nextAction: "Run instacart-pp-cli auth login.",
      ready: false
    });
    expect(buildSourceSetupChecklist(instacart, true, "not_configured", { sourceItemCount: 3 })).toMatchObject({
      missing: [],
      nextAction: "Ready with imported local source records. Authenticate this source to refresh it automatically.",
      ready: true
    });
    expect(buildSourceSetupChecklist(instacart, true, "connected", { sourceItemCount: 3 })).toMatchObject({
      missing: [],
      nextAction: "Ready with local source records.",
      ready: true
    });

    const airbnb = sourceAdapterDefinitions.find((adapter) => adapter.id === "source_airbnb")!;
    const airbnbConnectedWithoutRecords = buildSourceSetupChecklist(airbnb, true, "connected", { sourceItemCount: 0 });

    expect(airbnbConnectedWithoutRecords).toMatchObject({
      missing: ["Sync Airbnb wishlist/listing context or import real Airbnb reservation/trip JSON/JSONL/CSV/ICS/ZIP records."],
      nextAction: "Run airbnb-pp-cli wishlist sync --agent, or import a real Airbnb reservation/trip CSV/ICS/ZIP export in Settings.",
      ready: false
    });
    expect(airbnbConnectedWithoutRecords.commands.map((command) => command.command)).toContain(
      "airbnb-pp-cli wishlist sync --agent"
    );

    const outlook = sourceAdapterDefinitions.find((adapter) => adapter.id === "source_outlook_email")!;
    expect(buildSourceSetupChecklist(outlook, true, "not_configured", { sourceItemCount: 0 }).commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "outlook-email-pp-cli auth login --device-code",
          kind: "auth"
        }),
        expect.objectContaining({
          command: "outlook-email-pp-cli auth set-token <token>",
          kind: "auth"
        })
      ])
    );
  });

  it("requires every source adapter to be ready before source readiness is green", () => {
    const diagnostics = {
      adapters: sourceAdapterDefinitions.map((adapter, index) => ({
        ...adapter,
        installed: true,
        setup: {
          commands: [],
          missing: index === 0 ? [] : ["Backfill or import real source records."],
          nextAction: index === 0 ? "Ready with local source records." : "Backfill source history or import real JSON/JSONL records.",
          ready: index === 0
        },
        status: index === 0 ? ("connected" as const) : ("stale" as const),
        storage: {
          evidenceLinkCount: 0,
          sourceId: adapter.id,
          sourceItemCount: index === 0 ? 4 : 0
        }
      })),
      summary: {
        evidenceLinkCount: 0,
        externalSourceCount: sourceAdapterDefinitions.length,
        sourceItemCount: 4
      }
    };

    expect(summarizeSourceReadiness(diagnostics)).toMatchObject({
      blockedCount: sourceAdapterDefinitions.length - 1,
      installedCount: sourceAdapterDefinitions.length,
      ready: false,
      readyCount: 1,
      sourceItemCount: 4,
      totalCount: sourceAdapterDefinitions.length
    });

    const allReady = {
      ...diagnostics,
      adapters: diagnostics.adapters.map((adapter) => ({
        ...adapter,
        setup: {
          ...adapter.setup,
          missing: [],
          nextAction: "Ready with local source records.",
          ready: true
        },
        status: "connected" as const
      }))
    };

    expect(summarizeSourceReadiness(allReady)).toMatchObject({
      blockedCount: 0,
      ready: true,
      readyCount: sourceAdapterDefinitions.length
    });
  });
});

function airbnbIcsFixture(): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:airbnb-trip-1",
    "DTSTART;VALUE=DATE:20260610",
    "DTEND;VALUE=DATE:20260614",
    "SUMMARY:Airbnb reservation: Downtown loft",
    "DESCRIPTION:Confirmation code: HMABC123\\nTrip receipt total $1047.25",
    "LOCATION:Austin, TX",
    "STATUS:CONFIRMED",
    "URL:https://www.airbnb.com/trips/v1/HMABC123",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\n");
}

function createStoredZipBase64(filename: string, content: string): string {
  const contentBytes = Buffer.from(content, "utf8");
  return createZipBase64({
    compressedBytes: contentBytes,
    compressionMethod: 0,
    declaredUncompressedSize: contentBytes.length,
    filename
  });
}

function createDeflatedZipBase64(filename: string, content: Buffer | string, declaredUncompressedSize: number): string {
  const contentBytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createZipBase64({
    compressedBytes: deflateRawSync(contentBytes),
    compressionMethod: 8,
    declaredUncompressedSize,
    filename
  });
}

function createZipBase64(input: {
  compressedBytes: Buffer;
  compressionMethod: number;
  declaredUncompressedSize: number;
  filename: string;
}): string {
  const filenameBytes = Buffer.from(input.filename, "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(input.compressionMethod, 8);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(input.compressedBytes.length, 18);
  localHeader.writeUInt32LE(input.declaredUncompressedSize, 22);
  localHeader.writeUInt16LE(filenameBytes.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(input.compressionMethod, 10);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(input.compressedBytes.length, 20);
  centralHeader.writeUInt32LE(input.declaredUncompressedSize, 24);
  centralHeader.writeUInt16LE(filenameBytes.length, 28);
  centralHeader.writeUInt32LE(0, 42);

  const centralDirectory = Buffer.concat([centralHeader, filenameBytes]);
  const localFile = Buffer.concat([localHeader, filenameBytes, input.compressedBytes]);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localFile.length, 16);

  return Buffer.concat([localFile, centralDirectory, endOfCentralDirectory]).toString("base64");
}

function useTempDb(): void {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-pglite-")), "db");
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_TELLER_BACKUP_PATH = path.join(path.dirname(testDbPath), "teller-ledger-backup.json");
}

function useFakeCommand(name: string, stderr: string): void {
  testBinPath = mkdtempSync(path.join(tmpdir(), "ai-finances-bin-"));
  const commandPath = path.join(testBinPath, name);
  writeFileSync(commandPath, `#!/bin/sh\necho ${JSON.stringify(stderr)} >&2\nexit 42\n`);
  chmodSync(commandPath, 0o755);
  process.env.PATH = `${testBinPath}${path.delimiter}${originalPath ?? ""}`;
}

function useFlakyJsonCommand(name: string, stdout: string, firstStderr: string): string {
  testBinPath = mkdtempSync(path.join(tmpdir(), "ai-finances-bin-"));
  const commandPath = path.join(testBinPath, name);
  const counterPath = path.join(testBinPath, `${name}-count`);
  writeFileSync(
    commandPath,
    [
      "#!/bin/sh",
      `count_file=${JSON.stringify(counterPath)}`,
      "count=$(cat \"$count_file\" 2>/dev/null || echo 0)",
      "count=$((count + 1))",
      "echo \"$count\" > \"$count_file\"",
      "if [ \"$count\" -eq 1 ]; then",
      `  echo ${JSON.stringify(firstStderr)} >&2`,
      "  exit 42",
      "fi",
      `printf '%s\\n' ${JSON.stringify(stdout)}`,
      ""
    ].join("\n")
  );
  chmodSync(commandPath, 0o755);
  process.env.PATH = `${testBinPath}${path.delimiter}${originalPath ?? ""}`;

  return counterPath;
}
