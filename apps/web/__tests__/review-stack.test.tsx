import type { Account, Category, Transaction } from "@ai-finances/schema";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStack } from "@/components/review-stack";
import { getTransactionViews } from "@/lib/view-models";

const account: Account = { currency: "USD", currentBalance: 0, groupId: "group_credit", id: "acct", includedInNetWorth: true, institutionName: "Bank", lastUpdatedAt: "2026-07-13", mask: "1234", name: "Card", providerConnectionId: "provider", type: "credit_card" };
const categories: Category[] = [
  { archived: false, color: "#f90", emoji: "🍽️", icon: "circle", id: "cat_food", name: "Food", sortOrder: 10 },
  { archived: false, color: "#09f", emoji: "🚗", icon: "circle", id: "cat_transportation", name: "Transportation", sortOrder: 20 }
];
const transaction: Transaction = { accountId: "acct", amount: -42, categoryId: "cat_food", currency: "USD", date: "2026-07-13", description: "Ride", id: "txn_1", merchantName: "Uber", postedDate: "2026-07-13", providerConnectionId: "provider", reviewed: false, status: "posted", tags: [] };

describe("ReviewStack", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 }))));
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a suggested category and can undo the review", async () => {
    render(<ReviewStack categories={categories} initialTransactions={getTransactionViews([transaction], { accounts: [account], categories })} suggestions={{ txn_1: "cat_transportation" }} />);
    await userEvent.click(screen.getByRole("button", { name: /Accept/ }));
    expect(await screen.findByRole("heading", { name: "Review complete" })).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/v1/transactions/txn_1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ category_id: "cat_transportation", reviewed: true }) }));

    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(screen.getByText("Uber")).toBeInTheDocument());
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/v1/transactions/txn_1", expect.objectContaining({ body: JSON.stringify({ category_id: "cat_food", reviewed: false }) }));
  });

  it("skips with the j shortcut without mutating the transaction", async () => {
    render(<ReviewStack categories={categories} initialTransactions={getTransactionViews([transaction], { accounts: [account], categories })} suggestions={{}} />);
    await userEvent.keyboard("j");
    expect(await screen.findByRole("heading", { name: "Review complete" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
