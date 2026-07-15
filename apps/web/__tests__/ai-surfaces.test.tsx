import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentAnswer } from "@/components/agent-answer";
import { InsightsFeed } from "@/components/insights-feed";
import type { AgentMeta } from "@/lib/hooks/use-agent-stream";
import type { FinanceInsight } from "@/lib/insights";

class TestResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

const meta: AgentMeta = {
  evidence: [
    {
      amount: -42,
      category: "Transportation",
      currency: "USD",
      date: "2026-07-14",
      merchant: "Uber",
      reason: "Matched the ledger query",
      transactionId: "txn_uber",
    },
  ],
  generatedAt: "2026-07-15T12:00:00.000Z",
  insights: [],
  metrics: [],
  mode: "local_semantic_agent",
  question: "Where did I spend?",
};

const insight: FinanceInsight = {
  amount: 64,
  categoryId: "cat_transportation",
  detail: "Transportation was $64.00 higher than the previous seven days.",
  id: "category-delta:cat-transportation",
  kind: "category-delta",
  title: "Transportation increased this week",
  tone: "negative",
};

describe("AI surface upgrades", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("scrollTo", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the truthful thinking indicator before stream text arrives", () => {
    render(<AgentAnswer answer="" meta={null} question="Where did I spend?" status="streaming" />);

    expect(screen.getByRole("status")).toHaveTextContent("Reading your ledger");
    expect(screen.queryByText("▍")).not.toBeInTheDocument();
  });

  it("opens a numbered evidence toggletip linking to the exact transaction", async () => {
    render(<AgentAnswer answer="Ledger answer" meta={meta} question={meta.question} status="done" />);

    await userEvent.click(screen.getByRole("button", { name: "Evidence 1: Uber" }));

    expect(await screen.findByRole("link", { name: /View transaction/ })).toHaveAttribute(
      "href",
      "/transactions?transaction_id=txn_uber"
    );
  });

  it("explains an insight with its real detector method and ledger source", async () => {
    render(<InsightsFeed initialInsights={[insight]} />);

    await userEvent.click(screen.getByRole("button", { name: /Why this insight/ }));

    expect(screen.getByText("Compared adjacent seven-day windows")).toBeVisible();
    expect(screen.getByRole("link", { name: "Matching transactions" })).toHaveAttribute(
      "href",
      "/transactions?category_id=cat_transportation"
    );
  });

  it("uses the compact insight stack without losing dismiss behavior", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<InsightsFeed compact initialInsights={[insight]} />);

    expect(screen.getByRole("button", { name: "1 notifications. Expand notifications." })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: `Dismiss ${insight.title}` }));

    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/insights/${encodeURIComponent(insight.id)}`, { method: "DELETE" });
    expect(screen.getByText("All caught up")).toBeVisible();
    expect(screen.getByRole("link", { name: "Review transactions" })).toHaveAttribute("href", "/transactions");
  });
});
