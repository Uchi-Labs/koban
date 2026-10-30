import type { Account, Category, Transaction } from "@ai-finances/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewConfidenceFor, reviewConfidentThreshold } from "@/components/review-confidence";
import { ReviewStack } from "@/components/review-stack";
import { getTransactionViews } from "@/lib/view-models";

const account: Account = { currency: "USD", currentBalance: 0, groupId: "group_credit", id: "acct", includedInNetWorth: true, institutionName: "Bank", lastUpdatedAt: "2026-07-13", mask: "1234", name: "Card", providerConnectionId: "provider", type: "credit_card" };
const categories: Category[] = [
  { archived: false, color: "#f90", emoji: "🍽️", icon: "circle", id: "cat_food", name: "Food", sortOrder: 10 },
  { archived: false, color: "#09f", emoji: "🚗", icon: "circle", id: "cat_transportation", name: "Transportation", sortOrder: 20 }
];
const transaction: Transaction = { accountId: "acct", amount: -42, categoryId: "cat_food", currency: "USD", date: "2026-07-13", description: "Ride", id: "txn_1", merchantName: "Uber", postedDate: "2026-07-13", providerConnectionId: "provider", reviewed: false, status: "posted", tags: [] };
const views = () => getTransactionViews([transaction], { accounts: [account], categories });

describe("reviewConfidenceFor", () => {
  it("flags missing suggestions and scores under the trust bar", () => {
    expect(reviewConfidenceFor(undefined)).toEqual({ kind: "no_suggestion" });
    expect(reviewConfidenceFor({ categoryId: "cat_food", confidence: 0.6 })).toEqual({ kind: "low", score: 0.6 });
    expect(reviewConfidenceFor({ categoryId: "cat_food", confidence: reviewConfidentThreshold })).toEqual({ kind: "confident" });
  });

  it("does not guess when a suggestion's confidence is unknown", () => {
    expect(reviewConfidenceFor({ categoryId: "cat_food" })).toEqual({ kind: "confident" });
  });
});

describe("ReviewStack context for unsure cards", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 }))));
  afterEach(() => vi.unstubAllGlobals());

  it("opens the context field unfocused on a low-confidence card", async () => {
    render(<ReviewStack categories={categories} confidences={{ txn_1: 0.62 }} initialTransactions={views()} suggestions={{ txn_1: "cat_transportation" }} />);
    expect(screen.getAllByText("62%")[0]).toBeInTheDocument();
    const field = screen.getAllByRole("textbox", { name: "Context for this transaction" }).find((element) => !element.closest("[aria-hidden='true']"))!;
    expect(field).not.toHaveFocus();

    // Shortcuts still work because nothing stole focus.
    await userEvent.keyboard("j");
    expect(await screen.findByRole("heading", { name: "Review complete" })).toBeInTheDocument();
  });

  it("keeps the context field closed on a confident card", () => {
    render(<ReviewStack categories={categories} confidences={{ txn_1: 0.91 }} initialTransactions={views()} suggestions={{ txn_1: "cat_transportation" }} />);
    expect(screen.queryByRole("textbox", { name: "Context for this transaction" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add context" })).toBeInTheDocument();
  });

  it("saves context through the context-notes API", async () => {
    render(<ReviewStack categories={categories} initialTransactions={views()} suggestions={{}} />);
    const field = screen.getAllByRole("textbox", { name: "Context for this transaction" }).find((element) => !element.closest("[aria-hidden='true']"))!;
    await userEvent.type(field, "Airport ride for the Denver work trip");
    await userEvent.click(screen.getByRole("button", { name: "Queue for next pass" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/transactions/txn_1/context-notes",
      expect.objectContaining({ body: JSON.stringify({ body: "Airport ride for the Denver work trip" }), method: "POST" })
    );
    expect(await screen.findByText("Airport ride for the Denver work trip")).toBeInTheDocument();
  });

  it("does not swipe the card while scrolling inside the note", () => {
    render(<ReviewStack categories={categories} initialTransactions={views()} suggestions={{}} />);
    const field = screen.getAllByRole("textbox", { name: "Context for this transaction" }).find((element) => !element.closest("[aria-hidden='true']"))!;
    field.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: -140 }));
    expect(screen.getByRole("heading", { name: "Uber" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
