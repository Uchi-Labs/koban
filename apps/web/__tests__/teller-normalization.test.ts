import type { Account, Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { normalizeProviderCurrencyCode, normalizeTellerLedgerAmounts } from "@/lib/teller-normalization";

const checkingAccount = {
  id: "acct_checking",
  providerConnectionId: "provider_teller_test",
  groupId: "group_cash",
  name: "Checking",
  institutionName: "Test Bank",
  type: "checking",
  currency: "USD",
  currentBalance: 1000,
  includedInNetWorth: true,
  lastUpdatedAt: "2026-05-31T00:00:00.000Z"
} satisfies Account;

const creditCardAccount = {
  ...checkingAccount,
  id: "acct_card",
  groupId: "group_credit",
  name: "Credit Card",
  type: "credit_card"
} satisfies Account;

function transaction(overrides: Pick<Transaction, "accountId" | "amount" | "id">) {
  return {
    providerConnectionId: "provider_teller_test",
    date: "2026-05-30",
    postedDate: "2026-05-30",
    merchantName: "Merchant",
    description: "MERCHANT",
    currency: "USD",
    categoryId: "cat_other",
    status: "posted",
    reviewed: false,
    tags: ["teller"],
    ...overrides
  } satisfies Transaction;
}

describe("Teller amount normalization", () => {
  it("preserves valid provider currency codes and falls back only for invalid values", () => {
    expect(normalizeProviderCurrencyCode("usd")).toBe("USD");
    expect(normalizeProviderCurrencyCode("cad")).toBe("CAD");
    expect(normalizeProviderCurrencyCode(" EUR ")).toBe("EUR");
    expect(normalizeProviderCurrencyCode("")).toBe("USD");
    expect(normalizeProviderCurrencyCode("USDT")).toBe("USD");
  });

  it("keeps deposit account signs and inverts credit card liability signs", () => {
    const result = normalizeTellerLedgerAmounts({
      accounts: [checkingAccount, creditCardAccount],
      transactions: [
        transaction({ id: "txn_checking_spend", accountId: "acct_checking", amount: -12.34 }),
        transaction({ id: "txn_checking_deposit", accountId: "acct_checking", amount: 100 }),
        transaction({ id: "txn_card_purchase", accountId: "acct_card", amount: 45.67 }),
        transaction({ id: "txn_card_payment", accountId: "acct_card", amount: -200 })
      ]
    });

    expect(result.changed).toBe(true);
    expect(result.ledger.transactions.map((candidate) => candidate.amount)).toEqual([-12.34, 100, -45.67, 200]);
    expect(result.ledger.normalization.amountSignConvention).toBe("internal_v1");
  });

  it("does not normalize an already-marked ledger twice", () => {
    const first = normalizeTellerLedgerAmounts({
      accounts: [creditCardAccount],
      transactions: [transaction({ id: "txn_card_purchase", accountId: "acct_card", amount: 45.67 })]
    });
    const second = normalizeTellerLedgerAmounts(first.ledger);

    expect(second.changed).toBe(false);
    expect(second.ledger.transactions[0].amount).toBe(-45.67);
  });
});
