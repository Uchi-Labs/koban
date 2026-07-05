import { describe, expect, it } from "vitest";
import {
  parseBoundedLimit,
  parseTransactionReviewFilter,
  serializeTransaction,
  transactionMatchesReviewFilter
} from "@/lib/finance-api";
import type { Account, Category, Transaction } from "@ai-finances/schema";

describe("finance API helpers", () => {
  it("parses bounded list limits without leaking NaN or unsafe values", () => {
    expect(parseBoundedLimit("25", 50)).toBe(25);
    expect(parseBoundedLimit("abc", 50)).toBe(50);
    expect(parseBoundedLimit("1abc", 50)).toBe(50);
    expect(parseBoundedLimit("", 50)).toBe(50);
    expect(parseBoundedLimit(12.9, 50)).toBe(12);
    expect(parseBoundedLimit(Number.NaN, 50)).toBe(50);
    expect(parseBoundedLimit(0, 50)).toBe(1);
    expect(parseBoundedLimit(10_000, 50, 250)).toBe(250);
  });

  it("parses and applies transaction review filters with actionable semantics", () => {
    expect(parseTransactionReviewFilter({ review: "actionable", reviewed: null })).toBe("actionable");
    expect(parseTransactionReviewFilter({ review: "needs-review", reviewed: null })).toBe("actionable");
    expect(parseTransactionReviewFilter({ review: null, reviewed: "false" })).toBe("unreviewed");
    expect(parseTransactionReviewFilter({ review: null, reviewed: "true" })).toBe("reviewed");

    expect(transactionMatchesReviewFilter(transaction({ categoryId: "cat_other", reviewed: false }), "actionable")).toBe(true);
    expect(transactionMatchesReviewFilter(transaction({ categoryId: "cat_transfer", reviewed: false }), "actionable")).toBe(false);
    expect(transactionMatchesReviewFilter(transaction({ amount: 100, categoryId: "cat_income", reviewed: false }), "actionable")).toBe(false);
    expect(transactionMatchesReviewFilter(transaction({ categoryId: "cat_food", reviewed: true }), "actionable")).toBe(false);
    expect(transactionMatchesReviewFilter(transaction({ categoryId: "cat_transfer", reviewed: false }), "unreviewed")).toBe(true);
  });

  it("serializes whether a transaction belongs in the actionable review queue", () => {
    const accounts = [
      {
        id: "acct_1",
        providerConnectionId: "provider_teller_test",
        groupId: "group_cash",
        name: "Checking",
        institutionName: "Test Bank",
        type: "checking",
        currency: "USD",
        currentBalance: 100,
        includedInNetWorth: true,
        lastUpdatedAt: "2026-05-31T00:00:00.000Z"
      }
    ] satisfies Account[];
    const categories = [
      { id: "cat_other", name: "Other", icon: "circle", color: "#94a3b8", sortOrder: 900 },
      { id: "cat_transfer", name: "Transfer", icon: "repeat", color: "#64748b", sortOrder: 800 }
    ] satisfies Category[];

    expect(serializeTransaction(transaction({ categoryId: "cat_other" }), { accounts, categories })).toMatchObject({
      needs_review: true,
      reviewed: false
    });
    expect(serializeTransaction(transaction({ categoryId: "cat_transfer" }), { accounts, categories })).toMatchObject({
      needs_review: false,
      reviewed: false
    });
  });
});

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_test",
    accountId: "acct_1",
    providerConnectionId: "provider_teller_test",
    date: "2026-05-31",
    postedDate: "2026-05-31",
    merchantName: "Merchant",
    description: "Merchant purchase",
    amount: -10,
    currency: "USD",
    categoryId: "cat_other",
    status: "posted",
    reviewed: false,
    tags: [],
    ...overrides
  };
}
