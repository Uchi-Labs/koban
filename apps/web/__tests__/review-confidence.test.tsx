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

  it("flags a low-confidence card without taking focus from the shortcuts", async () => {
    render(<ReviewStack categories={categories} confidences={{ txn_1: 0.62 }} initialTransactions={views()} suggestions={{ txn_1: "cat_transportation" }} />);
    expect(screen.getAllByText("62%")[0]).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add context" })).not.toHaveFocus();

    // Shortcuts still work because nothing stole focus.
    await userEvent.keyboard("j");
    expect(await screen.findByRole("heading", { name: "Review complete" })).toBeInTheDocument();
  });

  it("does not flag a confident card", () => {
    render(<ReviewStack categories={categories} confidences={{ txn_1: 0.91 }} initialTransactions={views()} suggestions={{ txn_1: "cat_transportation" }} />);
    expect(screen.queryByText(/Not sure/)).not.toBeInTheDocument();
  });

  it("shows why the card was filed and the evidence behind it", () => {
    render(
      <ReviewStack
        categories={categories}
        contexts={{ txn_1: { evidence: [{ confidence: 0.84, relationship: "receipt", sourceLabel: "Gmail", summary: "", title: "Your Tuesday evening trip with Uber" }], notes: [], reason: "Uber rides are transportation." } }}
        initialTransactions={views()}
        suggestions={{}}
      />
    );
    expect(screen.getAllByText("Uber rides are transportation.")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Your Tuesday evening trip with Uber")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Gmail · 84% match")[0]).toBeInTheDocument();
  });

  it("saves context through the context-notes API", async () => {
    render(<ReviewStack categories={categories} initialTransactions={views()} suggestions={{}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Add context" }), "Airport ride for the Denver work trip");
    await userEvent.click(screen.getByRole("button", { name: "Save context" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/transactions/txn_1/context-notes",
      expect.objectContaining({ body: JSON.stringify({ body: "Airport ride for the Denver work trip" }), method: "POST" })
    );
    expect((await screen.findAllByText("Airport ride for the Denver work trip"))[0]).toBeInTheDocument();
  });

  it("does not swipe the card while scrolling inside the context field", () => {
    render(<ReviewStack categories={categories} initialTransactions={views()} suggestions={{}} />);
    screen.getByRole("textbox", { name: "Add context" }).dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: -140 }));
    expect(screen.getByRole("heading", { name: "Uber" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
