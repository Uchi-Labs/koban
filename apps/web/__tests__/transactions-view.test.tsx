import type { Account, Category, Transaction } from "@ai-finances/schema";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionsView, p95AmountRangeMax } from "@/components/transactions-view";
import { getTransactionViews } from "@/lib/view-models";

const accounts = [
  {
    id: "acct_amex",
    providerConnectionId: "provider_plaid_test",
    groupId: "group_credit",
    name: "Amex Gold",
    institutionName: "American Express",
    type: "credit_card",
    mask: "1106",
    currency: "USD",
    currentBalance: -100,
    includedInNetWorth: true,
    lastUpdatedAt: "2026-05-23T00:00:00.000Z"
  },
  {
    id: "acct_chase",
    providerConnectionId: "provider_plaid_test",
    groupId: "group_credit",
    name: "Chase Sapphire",
    institutionName: "Chase",
    type: "credit_card",
    mask: "8843",
    currency: "USD",
    currentBalance: -200,
    includedInNetWorth: true,
    lastUpdatedAt: "2026-05-23T00:00:00.000Z"
  }
] satisfies Account[];

const categories = [
  { id: "cat_income", name: "Income", icon: "arrow-down-left", color: "#2fbf71", sortOrder: 5 },
  { id: "cat_food", name: "Food & Dining", icon: "utensils", color: "#f59e0b", sortOrder: 10 },
  { id: "cat_software", name: "Software", icon: "laptop", color: "#14b8a6", sortOrder: 20 },
  { id: "cat_travel", name: "Travel", icon: "plane", color: "#6366f1", sortOrder: 30 },
  { id: "cat_transfer", name: "Transfer", icon: "repeat", color: "#64748b", sortOrder: 40 }
] satisfies Category[];

const transactions = [
  {
    id: "txn_uber",
    accountId: "acct_chase",
    providerConnectionId: "provider_plaid_test",
    date: "2026-05-22",
    postedDate: "2026-05-22",
    merchantName: "Uber",
    description: "Uber trip",
    amount: -42.16,
    currency: "USD",
    categoryId: "cat_food",
    status: "posted",
    reviewed: false,
    tags: ["rideshare"]
  },
  {
    id: "txn_figma",
    accountId: "acct_amex",
    providerConnectionId: "provider_plaid_test",
    date: "2026-05-21",
    postedDate: "2026-05-21",
    merchantName: "Figma",
    description: "Figma plan",
    amount: -45,
    currency: "USD",
    categoryId: "cat_software",
    status: "posted",
    reviewed: false,
    tags: ["work"]
  },
  {
    id: "txn_github",
    accountId: "acct_amex",
    providerConnectionId: "provider_plaid_test",
    date: "2026-05-20",
    postedDate: "2026-05-20",
    merchantName: "GitHub",
    description: "GitHub plan",
    amount: -48,
    currency: "USD",
    categoryId: "cat_software",
    status: "posted",
    reviewed: false,
    tags: ["work"]
  },
  {
    id: "txn_airbnb",
    accountId: "acct_chase",
    providerConnectionId: "provider_plaid_test",
    date: "2026-05-19",
    postedDate: "2026-05-19",
    merchantName: "Airbnb",
    description: "Trip lodging",
    amount: -842.1,
    currency: "USD",
    categoryId: "cat_travel",
    status: "posted",
    reviewed: false,
    tags: ["trip"]
  },
  {
    id: "txn_payroll",
    accountId: "acct_chase",
    providerConnectionId: "provider_plaid_test",
    date: "2026-05-18",
    postedDate: "2026-05-18",
    merchantName: "Payroll",
    description: "PAYROLL DEPOSIT",
    amount: 1200,
    currency: "USD",
    categoryId: "cat_income",
    status: "posted",
    reviewed: false,
    tags: ["paycheck"]
  },
  {
    id: "txn_transfer",
    accountId: "acct_chase",
    providerConnectionId: "provider_plaid_test",
    date: "2026-05-17",
    postedDate: "2026-05-17",
    merchantName: "AMERICAN EXPRESS",
    description: "AMERICAN EXPRESS ACH PMT",
    amount: -200,
    currency: "USD",
    categoryId: "cat_transfer",
    status: "posted",
    reviewed: false,
    tags: ["plaid:ach"]
  },
  {
    id: "txn_reviewed",
    accountId: "acct_amex",
    providerConnectionId: "provider_plaid_test",
    date: "2026-05-16",
    postedDate: "2026-05-16",
    merchantName: "Reviewed Cafe",
    description: "Reviewed lunch",
    amount: -12,
    currency: "USD",
    categoryId: "cat_food",
    status: "posted",
    reviewed: true,
    tags: ["reviewed"]
  }
] satisfies Transaction[];

function renderTransactions(props: Partial<React.ComponentProps<typeof TransactionsView>> = {}) {
  render(
    <TransactionsView
      categories={categories}
      transactions={getTransactionViews(transactions, { accounts, categories })}
      {...props}
    />
  );
}

async function chooseSelectOption(label: string, optionName: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole("option", { name: optionName }));
}

describe("TransactionsView", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickAnchor: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:transactions");
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    vi.stubGlobal(
      "Blob",
      class TestBlob {
        constructor(
          private readonly parts: BlobPart[],
          public readonly options?: BlobPropertyBag
        ) {}

        async text() {
          return this.parts.map((part) => String(part)).join("");
        }
      }
    );
    clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { headers: { "Content-Type": "application/json" } }))
    );
  });

  afterEach(() => {
    clickAnchor.mockRestore();
    vi.unstubAllGlobals();
  });

  it("filters transactions by search text", async () => {
    renderTransactions();

    await userEvent.type(screen.getByLabelText("Search transactions"), "Uber");

    expect(screen.getAllByText("Uber").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Whole Foods Market")).not.toBeInTheDocument();
  });

  it("shows the command palette hint and clears transaction search", async () => {
    renderTransactions();

    expect(screen.getByLabelText("Command K")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search transactions"), "Uber");
    expect(screen.getByLabelText("Search transactions")).toHaveValue("Uber");

    await userEvent.click(screen.getByRole("button", { name: "Clear transaction search" }));

    expect(screen.getByLabelText("Search transactions")).toHaveValue("");
    expect(screen.getAllByTestId("transaction-row")).toHaveLength(transactions.length);
  });

  it("filters transactions by absolute amount using dollar input groups", async () => {
    renderTransactions();

    await userEvent.type(screen.getByLabelText("Minimum transaction amount"), "800");

    expect(screen.getByLabelText("Active transaction filters")).toHaveTextContent("Amount: from $800");
    expect(screen.getAllByText("Airbnb").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Payroll")).toBeInTheDocument();
    expect(screen.queryByText("Uber")).not.toBeInTheDocument();
    expect(screen.queryByText("Figma")).not.toBeInTheDocument();
  });

  it("keeps the p95 amount slider and numeric inputs synchronized", async () => {
    const transactionViews = getTransactionViews(transactions, { accounts, categories });
    expect(p95AmountRangeMax(transactionViews)).toBe(2000);
    renderTransactions();

    const maximumThumb = screen.getByRole("slider", { name: "Maximum transaction amount range" });
    expect(maximumThumb).toHaveAttribute("aria-valuemax", "2000");

    await userEvent.type(screen.getByLabelText("Maximum transaction amount"), "9999");
    expect(screen.getByLabelText("Maximum transaction amount")).toHaveValue("2000");
    expect(maximumThumb).toHaveAttribute("aria-valuenow", "2000");

    await userEvent.clear(screen.getByLabelText("Maximum transaction amount"));
    await userEvent.type(screen.getByLabelText("Maximum transaction amount"), "500");
    expect(maximumThumb).toHaveAttribute("aria-valuenow", "500");

    await userEvent.type(screen.getByLabelText("Minimum transaction amount"), "800");
    expect(screen.getByLabelText("Minimum transaction amount")).toHaveValue("500");
    expect(screen.getByRole("slider", { name: "Minimum transaction amount range" })).toHaveAttribute("aria-valuenow", "500");

    const minimumThumb = screen.getByRole("slider", { name: "Minimum transaction amount range" });
    await userEvent.clear(screen.getByLabelText("Minimum transaction amount"));
    await userEvent.clear(screen.getByLabelText("Maximum transaction amount"));
    minimumThumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByLabelText("Minimum transaction amount")).toHaveValue("20");
  });

  it("filters transactions by category", async () => {
    renderTransactions();

    await chooseSelectOption("Filter by category", "Software");

    expect(screen.getAllByText("Figma").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Airbnb")).not.toBeInTheDocument();
  });

  it("filters transactions to actionable review rows", async () => {
    renderTransactions({ initialReviewFilter: "actionable" });

    expect(screen.getByLabelText("Active transaction filters")).toHaveTextContent("Review: Needs review");
    expect(screen.getByLabelText("Filter by review state")).toHaveTextContent("Needs review");
    expect(screen.getAllByText("Uber").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Figma")).toBeInTheDocument();
    expect(screen.queryByText("Payroll")).not.toBeInTheDocument();
    expect(screen.queryByText("AMERICAN EXPRESS")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewed Cafe")).not.toBeInTheDocument();

    await chooseSelectOption("Filter by review state", "Reviewed");

    expect(screen.getByLabelText("Active transaction filters")).toHaveTextContent("Review: Reviewed");
    expect(screen.getAllByText("Reviewed Cafe").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Payroll")).not.toBeInTheDocument();
  });

  it("initializes from account, category, and search filters", async () => {
    renderTransactions({
      initialAccountId: "acct_amex",
      initialCategoryId: "cat_software",
      initialQuery: "GitHub"
    });

    expect(screen.getByLabelText("Active transaction filters")).toHaveTextContent("Account: Amex Gold 1106");
    expect(screen.getByLabelText("Active transaction filters")).toHaveTextContent("Category: Software");
    expect(screen.getByLabelText("Active transaction filters")).toHaveTextContent("Search: GitHub");
    expect(screen.getAllByText("GitHub").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Figma")).not.toBeInTheDocument();
    expect(screen.queryByText("Uber")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Loading evidence…")).not.toBeInTheDocument();
    });
  });

  it("updates the inspector when a row is selected", async () => {
    renderTransactions();

    // The row is a grid whose content is pointer-events-none over an absolutely
    // positioned overlay button ("Select <merchant>") that captures the click.
    const airbnbRow = screen.getByRole("button", { name: "Select Airbnb" });

    await userEvent.click(airbnbRow);

    const inspector = screen.getByLabelText("Selected transaction inspector");
    expect(within(inspector).getByRole("heading", { name: "Airbnb" })).toBeInTheDocument();
    expect(within(inspector).getByText("Chase Sapphire 8843")).toBeInTheDocument();
  });

  it("closes the inspector without losing the transaction list", async () => {
    renderTransactions();

    await userEvent.click(screen.getByLabelText("Close inspector"));

    expect(screen.getByTestId("empty-inspector")).toHaveTextContent("No transaction selected");
    expect(screen.getAllByTestId("transaction-row")).toHaveLength(transactions.length);
  });

  it("grafts bulk actions onto the static transaction rows without replacing the list", async () => {
    renderTransactions();

    await userEvent.click(screen.getByLabelText("Select Figma for bulk actions"));

    const bulkActions = screen.getByLabelText("Bulk transaction actions");
    expect(bulkActions).toHaveTextContent("1selected");
    expect(within(bulkActions).getByRole("button", { name: "Category" })).toBeInTheDocument();
    expect(within(bulkActions).getByRole("button", { name: "Add tag" })).toBeInTheDocument();
    expect(within(bulkActions).getByRole("button", { name: "Mark reviewed" })).toBeInTheDocument();
    expect(screen.getAllByTestId("transaction-row")).toHaveLength(transactions.length);
  });

  it("loops the existing transaction PATCH when bulk-marking selected rows reviewed", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === "PATCH" && url === "/api/v1/transactions/txn_figma") {
        return new Response(JSON.stringify({ object: "transaction", reviewed: true }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ data: [] }), {
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTransactions();

    await userEvent.click(screen.getByLabelText("Select Figma for bulk actions"));
    await userEvent.click(within(screen.getByLabelText("Bulk transaction actions")).getByRole("button", { name: "Mark reviewed" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/transactions/txn_figma",
        expect.objectContaining({
          body: JSON.stringify({ reviewed: true }),
          method: "PATCH"
        })
      );
    });
    await waitFor(() => {
      expect(screen.queryByLabelText("Bulk transaction actions")).not.toBeInTheDocument();
    });
  });

  it("reveals the beui overflow action set for a row", async () => {
    renderTransactions();

    await userEvent.click(screen.getByRole("button", { name: "Show actions for Figma" }));

    expect(screen.getByRole("button", { name: "Mark Figma reviewed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit category for Figma" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add tag to Figma" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exclude Figma" })).toBeInTheDocument();
  });

  it("toggles the selected transaction review state through the local v1 API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === "PATCH" && url === "/api/v1/transactions/txn_uber") {
        const body = JSON.parse(String(init.body)) as { reviewed: boolean };
        return new Response(JSON.stringify({ object: "transaction", reviewed: body.reviewed }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ data: [] }), {
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTransactions();

    await userEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));

    await waitFor(() => {
      expect(screen.getByText("Marked reviewed.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Move to review" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Selected transaction inspector")).getByText("Reviewed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Move to review" }));

    await waitFor(() => {
      expect(screen.getByText("Moved back to review.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/transactions/txn_uber",
      expect.objectContaining({
        body: JSON.stringify({ reviewed: true }),
        method: "PATCH"
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/transactions/txn_uber",
      expect.objectContaining({
        body: JSON.stringify({ reviewed: false }),
        method: "PATCH"
      })
    );
  });

  it("adds and removes transaction tags through the inline local v1 API control", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === "PATCH" && url === "/api/v1/transactions/txn_uber") {
        const body = JSON.parse(String(init.body)) as { tags: string[] };
        return new Response(JSON.stringify({ object: "transaction", tags: body.tags }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ data: [] }), {
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTransactions();

    await userEvent.type(screen.getByLabelText("New transaction tag"), "airport");
    await userEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() => {
      expect(screen.getByText("Tags saved to the local transaction ledger.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Remove tag airport" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/transactions/txn_uber",
      expect.objectContaining({
        body: JSON.stringify({ tags: ["rideshare", "airport"] }),
        method: "PATCH"
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove tag rideshare" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/transactions/txn_uber",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["airport"] }),
          method: "PATCH"
        })
      );
    });
  });

  it("searches imported source items and links evidence to the selected transaction", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith("/api/v1/source-items")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "src_uber_receipt",
                kind: "email",
                merchant_name: "Uber",
                source_id: "source_outlook_email",
                summary: "Receipt for the airport ride.",
                title: "Uber receipt"
              }
            ]
          }),
          {
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (init?.method === "POST" && url === "/api/v1/transactions/txn_uber/evidence") {
        return new Response(
          JSON.stringify({
            object: "transaction_evidence",
            confidence: 1,
            relationship: "receipt",
            source_item: {
              id: "src_uber_receipt",
              kind: "email",
              summary: "Receipt for the airport ride.",
              title: "Uber receipt"
            },
            status: "accepted",
            transaction_id: "txn_uber"
          }),
          {
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(JSON.stringify({ data: [] }), {
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTransactions();

    await userEvent.click(screen.getByText("Link source item"));
    await userEvent.type(screen.getByLabelText("Search imported evidence"), "Uber");
    await userEvent.click(screen.getByRole("button", { name: "Search source items" }));

    expect(await screen.findByText("Uber receipt")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Link evidence Uber receipt" }));

    await waitFor(() => {
      expect(screen.getByText("Evidence linked.")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/transactions/txn_uber/evidence",
      expect.objectContaining({
        body: JSON.stringify({
          source_item_id: "src_uber_receipt",
          status: "accepted"
        }),
        method: "POST"
      })
    );
  });

  it("downloads the currently filtered Plaid transactions as CSV", async () => {
    renderTransactions();

    await userEvent.type(screen.getByLabelText("Search transactions"), "Uber");
    await userEvent.click(screen.getByLabelText("Download transactions"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:transactions");
    expect(clickAnchor).toHaveBeenCalledTimes(1);

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain("Uber trip");
    expect(csv).not.toContain("Airbnb");
  });
});
