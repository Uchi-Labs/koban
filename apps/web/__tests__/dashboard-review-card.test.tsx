import type { Account, Category, Transaction } from "@ai-finances/schema";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardReviewCard } from "@/components/dashboard-review-card";
import { getTransactionViews } from "@/lib/view-models";

const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock
  })
}));

const account = {
  currency: "USD",
  currentBalance: 1000,
  groupId: "group_credit",
  id: "acct_card",
  includedInNetWorth: true,
  institutionName: "Chase",
  lastUpdatedAt: "2026-05-31T00:00:00.000Z",
  mask: "1234",
  name: "Sapphire",
  providerConnectionId: "provider_teller_test",
  type: "credit_card"
} satisfies Account;

const categories = [
  { color: "#f59e0b", icon: "utensils", id: "cat_food", name: "Food & Dining", sortOrder: 10 }
] satisfies Category[];

const transactions = [
  createTransaction("txn_1", "Uber Eats", -18.5),
  createTransaction("txn_2", "Instacart", -62.25)
] satisfies Transaction[];

describe("DashboardReviewCard", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ object: "transaction", reviewed: true }), { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks the visible review batch as reviewed through the local transaction API", async () => {
    render(
      <DashboardReviewCard
        initialRows={getTransactionViews(transactions, { accounts: [account], categories })}
        reviewSectionLabel="Latest"
        totalToReview={2}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark 2 as reviewed" }));

    await waitFor(() => {
      expect(screen.getByText("2 transactions marked reviewed.")).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith("/api/v1/transactions/txn_1", expect.objectContaining({ method: "PATCH" }));
    expect(fetch).toHaveBeenCalledWith("/api/v1/transactions/txn_2", expect.objectContaining({ method: "PATCH" }));
    expect(screen.getByText("No transactions need review in the current local ledger.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark 0 as reviewed" })).toBeDisabled();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

function createTransaction(id: string, merchantName: string, amount: number): Transaction {
  return {
    accountId: account.id,
    amount,
    categoryId: "cat_food",
    currency: "USD",
    date: "2026-05-31",
    description: merchantName,
    id,
    merchantName,
    postedDate: "2026-05-31",
    providerConnectionId: "provider_teller_test",
    reviewed: false,
    status: "posted",
    tags: []
  };
}
