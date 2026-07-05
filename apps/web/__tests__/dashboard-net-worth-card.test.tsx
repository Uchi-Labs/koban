import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "vitest";
import { DashboardNetWorthCard } from "@/components/dashboard-net-worth-card";

describe("DashboardNetWorthCard", () => {
  it("switches active ranges instead of rendering inert range labels", async () => {
    render(
      <DashboardNetWorthCard
        currentNetWorth={1200}
        trends={[
          { label: "1W", points: [{ label: "May 24", value: 1000 }, { label: "May 31", value: 1200 }] },
          { label: "1M", points: [{ label: "May 1", value: 800 }, { label: "May 31", value: 1200 }] },
          { label: "3M", points: [{ label: "Mar", value: 900 }, { label: "May", value: 1200 }] },
          { label: "YTD", points: [{ label: "Jan", value: 700 }, { label: "May", value: 1200 }] },
          { label: "1Y", points: [{ label: "Jun", value: 600 }, { label: "May", value: 1200 }] },
          { label: "ALL", points: [{ label: "2025", value: 500 }, { label: "May", value: 1200 }] }
        ]}
      />
    );

    const card = screen.getByTestId("net-worth-card");
    expect(card).toHaveAttribute("data-range", "1M");
    expect(screen.getByRole("button", { name: "1M" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "3M" }));

    expect(card).toHaveAttribute("data-range", "3M");
    expect(screen.getByRole("button", { name: "3M" })).toHaveAttribute("aria-pressed", "true");
  });
});
