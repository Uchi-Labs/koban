import type { Account, Transaction } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { createAccountGroups, createDashboardSummary, createRecurringItems, getAccountNetWorthContribution } from "@/lib/finance-data";
import { getTransactionViews } from "@/lib/view-models";

const account = {
  id: "acct_checking",
  providerConnectionId: "provider_plaid_test",
  groupId: "group_cash",
  name: "Checking",
  institutionName: "Test Bank",
  type: "checking",
  currency: "USD",
  currentBalance: 1000,
  includedInNetWorth: true,
  lastUpdatedAt: "2026-05-23T00:00:00.000Z"
} satisfies Account;

function transaction(overrides: Partial<Transaction> & Pick<Transaction, "id" | "date" | "merchantName" | "amount">) {
  return {
    accountId: account.id,
    providerConnectionId: "provider_plaid_test",
    description: overrides.merchantName,
    currency: "USD",
    categoryId: "cat_software",
    status: "posted",
    reviewed: false,
    tags: ["plaid"],
    ...overrides
  } satisfies Transaction;
}

describe("finance data derivation", () => {
  it("subtracts credit card and loan balances from net worth", () => {
    const checking = account;
    const creditCard = {
      ...account,
      id: "acct_card",
      groupId: "group_credit",
      name: "Credit Card",
      type: "credit_card",
      currentBalance: 250
    } satisfies Account;
    const loan = {
      ...account,
      id: "acct_loan",
      groupId: "group_other",
      name: "Loan",
      type: "loan",
      currentBalance: 100
    } satisfies Account;

    const summary = createDashboardSummary({
      accounts: [checking, creditCard, loan],
      accountGroups: [
        {
          accountIds: [checking.id],
          currency: "USD",
          id: "group_cash",
          includedInNetWorth: true,
          name: "Cash",
          sortOrder: 10,
          totalBalance: checking.currentBalance
        },
        {
          accountIds: [creditCard.id],
          currency: "USD",
          id: "group_credit",
          includedInNetWorth: true,
          name: "Credit cards",
          sortOrder: 20,
          totalBalance: creditCard.currentBalance
        }
      ],
      asOf: "2026-05-31T00:00:00.000Z",
      providerConnections: [],
      recurringItems: [],
      transactions: []
    });

    expect(getAccountNetWorthContribution(checking)).toBe(1000);
    expect(getAccountNetWorthContribution(creditCard)).toBe(-250);
    expect(getAccountNetWorthContribution(loan)).toBe(-100);
    expect(summary.netWorth).toBe(650);
    expect(summary.creditBalance).toBe(250);
  });

  it("infers recurring items from repeated Plaid transactions", () => {
    const recurringItems = createRecurringItems([
      transaction({ id: "txn_jan", date: "2026-01-05", merchantName: "Figma", amount: -45 }),
      transaction({ id: "txn_feb", date: "2026-02-04", merchantName: "Figma", amount: -45 }),
      transaction({ id: "txn_mar", date: "2026-03-06", merchantName: "Figma", amount: -45 }),
      transaction({ id: "txn_one_off", date: "2026-03-07", merchantName: "One Off", amount: -100 })
    ]);

    expect(recurringItems).toHaveLength(1);
    expect(recurringItems[0]).toMatchObject({
      name: "Figma",
      cadence: "monthly",
      averageAmount: 45,
      currency: "USD",
      nextDate: "2026-04-05",
      status: "watching"
    });
  });

  it("excludes transfers from spending, income, category, and recurring rollups", () => {
    const summary = createDashboardSummary({
      accounts: [account],
      accountGroups: createAccountGroups([account]),
      asOf: "2026-05-31T00:00:00.000Z",
      providerConnections: [],
      recurringItems: [],
      transactions: [
        transaction({ id: "txn_food", date: "2026-05-05", merchantName: "Grocer", amount: -40, categoryId: "cat_food" }),
        transaction({ id: "txn_transfer_out", date: "2026-05-06", merchantName: "Savings transfer", amount: -5000, categoryId: "cat_transfer" }),
        transaction({ id: "txn_transfer_in", date: "2026-05-07", merchantName: "Savings transfer", amount: 5000, categoryId: "cat_transfer" }),
        transaction({ id: "txn_payroll", date: "2026-05-08", merchantName: "Payroll", amount: 1200, categoryId: "cat_income" })
      ]
    });
    const recurringItems = createRecurringItems([
      transaction({ id: "txn_transfer_1", date: "2026-01-05", merchantName: "AMERICAN EXPRESS", amount: -1000, categoryId: "cat_transfer" }),
      transaction({ id: "txn_transfer_2", date: "2026-02-05", merchantName: "AMERICAN EXPRESS", amount: -1000, categoryId: "cat_transfer" }),
      transaction({ id: "txn_transfer_3", date: "2026-03-05", merchantName: "AMERICAN EXPRESS", amount: -1000, categoryId: "cat_transfer" })
    ]);

    expect(summary.monthlySpending).toBe(-40);
    expect(summary.monthlyIncome).toBe(1200);
    expect(summary.transactionsToReview).toBe(1);
    expect(summary.topCategories).toEqual([
      expect.objectContaining({
        amount: -40,
        categoryId: "cat_food"
      })
    ]);
    expect(recurringItems).toHaveLength(0);
  });

  it("does not relabel mixed-currency account or recurring aggregates as USD", () => {
    const cadAccount = {
      ...account,
      currency: "CAD",
      id: "acct_cad",
      name: "Canadian Checking"
    } satisfies Account;
    const groups = createAccountGroups([account, cadAccount]);
    const mixedSummary = createDashboardSummary({
      accounts: [account, cadAccount],
      accountGroups: groups,
      asOf: "2026-05-31T00:00:00.000Z",
      providerConnections: [],
      recurringItems: [],
      transactions: [
        transaction({ id: "txn_usd", date: "2026-05-05", merchantName: "USD Store", amount: -10 }),
        transaction({ id: "txn_cad", date: "2026-05-06", merchantName: "CAD Store", amount: -10, currency: "CAD" })
      ]
    });
    const mixedRecurring = createRecurringItems([
      transaction({ id: "txn_jan", date: "2026-01-05", merchantName: "Figma", amount: -45 }),
      transaction({ id: "txn_feb", date: "2026-02-04", merchantName: "Figma", amount: -45, currency: "CAD" }),
      transaction({ id: "txn_mar", date: "2026-03-06", merchantName: "Figma", amount: -45 })
    ]);

    expect(groups[0].currency).toBe("MIXED");
    expect(mixedSummary.currency).toBe("MIXED");
    expect(mixedRecurring[0].currency).toBe("MIXED");
  });

  it("groups transaction views relative to the latest synced Plaid transaction", () => {
    const views = getTransactionViews(
      [
        transaction({ id: "txn_old", date: "2026-05-20", merchantName: "Older", amount: -12 }),
        transaction({ id: "txn_latest", date: "2026-05-22", merchantName: "Latest", amount: -18 })
      ],
      { accounts: [account] }
    );

    expect(views.find((view) => view.id === "txn_latest")?.relativeDateLabel).toBe("Latest");
    expect(views.find((view) => view.id === "txn_old")?.relativeDateLabel).toBe("2 days before latest");
  });
});
