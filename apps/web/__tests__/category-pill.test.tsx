import type { Category } from "@ai-finances/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryPill } from "@/components/category-pill";
import { neutralCategoryColor } from "@/lib/category-style";

function category(overrides: Partial<Category> = {}): Category {
  return {
    archived: false,
    color: "#3b82f6",
    emoji: "✈️",
    icon: "plane",
    id: "cat_travel",
    name: "Travel",
    sortOrder: 10,
    ...overrides
  };
}

describe("CategoryPill", () => {
  it("uses the category emoji and trusted color through the shared tint variable", () => {
    render(<CategoryPill category={category()} />);

    const pill = screen.getByText("Travel").parentElement;
    expect(pill).toHaveClass("pill-tint");
    expect(pill?.style.getPropertyValue("--pill-color")).toBe("#3b82f6");
    expect(pill).toHaveTextContent("✈️Travel");
  });

  it("falls back to the category icon and a muted trusted tint", () => {
    render(<CategoryPill category={category({ color: "not-a-color", emoji: undefined, name: "Flights" })} />);

    const pill = screen.getByText("Flights").parentElement;
    expect(pill?.style.getPropertyValue("--pill-color")).toBe(neutralCategoryColor);
    expect(pill?.querySelector("svg")).not.toBeNull();
  });

  it("keeps transfers on the distinct blue chart tint", () => {
    render(<CategoryPill category={category({ color: "#ef4444", emoji: "🔁", id: "cat_transfer", name: "Transfer" })} />);

    const pill = screen.getByText("Transfer").parentElement;
    expect(pill).toHaveAttribute("data-transfer", "true");
    expect(pill?.style.getPropertyValue("--pill-color")).toBe("var(--chart-1)");
  });
});
