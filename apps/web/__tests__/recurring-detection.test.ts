import type { Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { createRecurringItems } from "@/lib/finance-data";

let sequence = 0;

function charge(merchantName: string, date: string, amount: number): Transaction {
  sequence += 1;
  return {
    id: `txn_${sequence}`,
    accountId: "acct_checking",
    providerConnectionId: "provider_teller_test",
    description: merchantName,
    merchantName,
    date,
    amount: -Math.abs(amount),
    currency: "USD",
    categoryId: "cat_software",
    status: "posted",
    reviewed: false,
    tags: ["teller"]
  } satisfies Transaction;
}

describe("recurring detection gates", () => {
  it("rejects a frequent merchant with irregular gaps and scattered amounts (Amazon)", () => {
    const items = createRecurringItems([
      charge("AMAZON", "2026-05-01", 12.99),
      charge("AMAZON", "2026-05-03", 89.5),
      charge("AMAZON", "2026-05-12", 55.16),
      charge("AMAZON", "2026-05-14", 210.0),
      charge("AMAZON", "2026-05-25", 8.45),
      charge("AMAZON", "2026-06-02", 34.2),
      charge("AMAZON", "2026-06-05", 66.6),
      charge("AMAZON", "2026-06-18", 149.99),
      charge("AMAZON", "2026-06-20", 22.15),
      charge("AMAZON", "2026-07-01", 74.8)
    ]);

    expect(items).toHaveLength(0);
  });

  it("rejects a merchant whose gaps drift too much for its cadence (Pirateship)", () => {
    const items = createRecurringItems([
      charge("PIRATESHIP", "2026-01-04", 21.5),
      charge("PIRATESHIP", "2026-01-22", 22.1),
      charge("PIRATESHIP", "2026-03-03", 21.5),
      charge("PIRATESHIP", "2026-03-28", 20.9),
      charge("PIRATESHIP", "2026-04-30", 22.4)
    ]);

    expect(items).toHaveLength(0);
  });

  it("rejects regular-gap charges whose amounts scatter (weekly groceries)", () => {
    const items = createRecurringItems([
      charge("WHOLEFOODS", "2026-06-01", 31.4),
      charge("WHOLEFOODS", "2026-06-08", 148.2),
      charge("WHOLEFOODS", "2026-06-15", 62.75),
      charge("WHOLEFOODS", "2026-06-22", 95.26),
      charge("WHOLEFOODS", "2026-06-29", 24.1)
    ]);

    expect(items).toHaveLength(0);
  });

  it("requires more than two gaps before minting a weekly subscription", () => {
    const items = createRecurringItems([
      charge("COFFEE CART", "2026-06-05", 6.5),
      charge("COFFEE CART", "2026-06-12", 6.5),
      charge("COFFEE CART", "2026-06-19", 6.5)
    ]);

    expect(items).toHaveLength(0);
  });

  it("keeps a monthly subscription through a price hike and uses the median amount", () => {
    const items = createRecurringItems([
      charge("NETFLIX", "2026-03-06", 12.99),
      charge("NETFLIX", "2026-04-06", 12.99),
      charge("NETFLIX", "2026-05-05", 15.49),
      charge("NETFLIX", "2026-06-05", 15.49),
      charge("NETFLIX", "2026-07-06", 15.49)
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ cadence: "monthly", name: "NETFLIX", averageAmount: 15.49 });
  });

  it("keeps a steady weekly subscription with enough evidence", () => {
    const items = createRecurringItems([
      charge("BOXING GYM", "2026-06-03", 25),
      charge("BOXING GYM", "2026-06-10", 25),
      charge("BOXING GYM", "2026-06-17", 25),
      charge("BOXING GYM", "2026-06-24", 25),
      charge("BOXING GYM", "2026-07-01", 25)
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ cadence: "weekly", name: "BOXING GYM" });
  });

  it("drops a subscription that missed two straight cycles (cancelled)", () => {
    const items = createRecurringItems([
      charge("HULU", "2026-01-15", 11.99),
      charge("HULU", "2026-02-15", 11.99),
      charge("HULU", "2026-03-15", 11.99),
      // unrelated activity moves the dataset's latest date well past HULU's next cycles
      charge("NETFLIX", "2026-04-06", 15.49),
      charge("NETFLIX", "2026-05-06", 15.49),
      charge("NETFLIX", "2026-06-06", 15.49)
    ]);

    expect(items.map((item) => item.name)).toEqual(["NETFLIX"]);
  });
});
