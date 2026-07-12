import type { Account, RecurringItem, Transaction } from "@ai-finances/schema";
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

function transaction(id: string, accountId: string, date: string): Transaction {
  return {
    accountId,
    amount: -25,
    categoryId: "cat_food",
    currency: "USD",
    date,
    description: id,
    id,
    merchantName: id,
    providerConnectionId: "provider_example",
    reviewed: false,
    status: "posted",
    tags: []
  };
}

function recurring(id: string, accountId: string): RecurringItem {
  return {
    accountId,
    amount: 25,
    averageAmount: 25,
    cadence: "monthly",
    categoryId: "cat_food",
    currency: "USD",
    id,
    name: id,
    nextDate: "2026-08-01",
    status: "active"
  };
}

describe("selectAccountDetailData", () => {
  it("scopes transactions and recurrings to the selected account", () => {
    const result = selectAccountDetailData(
      {
        accounts,
        recurringItems: [recurring("Cash subscription", "acct_cash"), recurring("Broker fee", "acct_investment")],
        transactions: [
          transaction("Older cash charge", "acct_cash", "2026-07-01"),
          transaction("Broker trade", "acct_investment", "2026-07-09"),
          transaction("Latest cash charge", "acct_cash", "2026-07-11")
        ]
      },
      "acct_cash"
    );

    expect(result?.account.id).toBe("acct_cash");
    expect(result?.transactions.map((item) => item.id)).toEqual(["Latest cash charge", "Older cash charge"]);
    expect(result?.recurringItems.map((item) => item.id)).toEqual(["Cash subscription"]);
  });
});
