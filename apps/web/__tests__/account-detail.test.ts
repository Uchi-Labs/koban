import type { Account, Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { selectAccountDetailData } from "@/lib/account-detail";

const accounts = [
  {
    currency: "USD",
    currentBalance: 1250,
    groupId: "group_cash",
    id: "acct_cash",
    includedInNetWorth: true,
    institutionName: "Example Bank",
    lastUpdatedAt: "2026-07-10T12:00:00Z",
    name: "Everyday Checking",
    providerConnectionId: "provider_example",
    type: "checking"
  },
  {
    currency: "USD",
    currentBalance: 8000,
    groupId: "group_investments",
    id: "acct_investment",
    includedInNetWorth: true,
    institutionName: "Example Brokerage",
    lastUpdatedAt: "2026-07-10T12:00:00Z",
    name: "Brokerage",
    providerConnectionId: "provider_example",
    type: "investment"
  }
] satisfies Account[];

function transaction(id: string, accountId: string, date: string, merchantName = id): Transaction {
  return {
    accountId,
    amount: -25,
    categoryId: "cat_food",
    currency: "USD",
    date,
    description: merchantName,
    id,
    merchantName,
    providerConnectionId: "provider_example",
    reviewed: false,
    status: "posted",
    tags: []
  };
}

describe("selectAccountDetailData", () => {
  it("scopes transactions and recurrings to the selected account", () => {
    const result = selectAccountDetailData(
      {
        accounts,
        transactions: [
          transaction("cash-jan", "acct_cash", "2026-01-01", "Cash subscription"),
          transaction("cash-feb", "acct_cash", "2026-02-01", "Cash subscription"),
          transaction("cash-mar", "acct_cash", "2026-03-01", "Cash subscription"),
          transaction("broker-jan", "acct_investment", "2026-01-09", "Broker fee"),
          transaction("broker-feb", "acct_investment", "2026-02-09", "Broker fee"),
          transaction("broker-mar", "acct_investment", "2026-03-09", "Broker fee")
        ]
      },
      "acct_cash"
    );

    expect(result?.account.id).toBe("acct_cash");
    expect(result?.transactions.map((item) => item.id)).toEqual(["cash-mar", "cash-feb", "cash-jan"]);
    expect(result?.transactions.every((item) => item.accountId === "acct_cash")).toBe(true);
    expect(result?.recurringItems.map((item) => item.name)).toEqual(["Cash subscription"]);
    expect(result?.recurringItems.every((item) => item.accountId === "acct_cash")).toBe(true);
  });
});
