import type { Category } from "@ai-finances/schema";
import { describe, expect, it } from "vitest";
import { deriveRuleMatchValue, filterCategories, parseRuleMatchSpec } from "@/lib/rule-match";

function category(id: string, name: string, emoji = "🏷️", color = "#888888"): Category {
  return { color, emoji, icon: "tag", id, name, sortOrder: 0 };
}

const categories: Category[] = [
  category("cat_food", "Restaurants", "🍽️"),
  category("cat_grocery", "Groceries", "🛒"),
  category("cat_gas", "Gas Stations", "⛽"),
  category("cat_sub", "Subscriptions", "🔁"),
  category("cat_gym", "Gym", "🏋️")
];

describe("filterCategories", () => {
  it("returns all categories for an empty query", () => {
    expect(filterCategories(categories, "")).toEqual(categories);
    expect(filterCategories(categories, "   ")).toEqual(categories);
  });

  it("matches a prefix of the name first", () => {
    const result = filterCategories(categories, "rest");
    expect(result[0]?.name).toBe("Restaurants");
  });

  it("matches a word prefix (fuzzy prefix on words)", () => {
    const result = filterCategories(categories, "sta");
    expect(result.map((entry) => entry.name)).toContain("Gas Stations");
  });

  it("falls back to substring matching", () => {
    const result = filterCategories(categories, "scription");
    expect(result.map((entry) => entry.name)).toEqual(["Subscriptions"]);
  });

  it("ranks name-prefix above word-prefix above substring", () => {
    const ranked = filterCategories(
      [category("c1", "Gym"), category("c2", "Gaming Gear"), category("c3", "Legacy")],
      "g"
    );
    expect(ranked.map((entry) => entry.name)).toEqual(["Gym", "Gaming Gear", "Legacy"]);
  });

  it("excludes non-matches", () => {
    expect(filterCategories(categories, "zzz")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(filterCategories(categories, "GROCER").map((entry) => entry.name)).toEqual(["Groceries"]);
  });
});

describe("deriveRuleMatchValue", () => {
  it("strips trailing store numbers on a whitespace boundary", () => {
    expect(deriveRuleMatchValue("Starbucks 19628")).toBe("Starbucks");
    expect(deriveRuleMatchValue("Shell Oil 4471")).toBe("Shell Oil");
  });

  it("strips trailing hash/dash numeric tokens", () => {
    expect(deriveRuleMatchValue("Whole Foods Market #123")).toBe("Whole Foods Market");
    expect(deriveRuleMatchValue("Target - 4471")).toBe("Target");
  });

  it("leaves fused letter+digit tokens untouched (no clean word boundary)", () => {
    expect(deriveRuleMatchValue("Sbux19628")).toBe("Sbux19628");
  });

  it("collapses internal whitespace and trims", () => {
    expect(deriveRuleMatchValue("  Blue   Bottle   Coffee  ")).toBe("Blue Bottle Coffee");
  });

  it("keeps the original when stripping would leave nothing meaningful", () => {
    expect(deriveRuleMatchValue("12345")).toBe("12345");
    expect(deriveRuleMatchValue("7-Eleven")).toBe("7-Eleven");
  });
});

describe("parseRuleMatchSpec", () => {
  it("accepts a valid spec and normalizes the value", () => {
    const result = parseRuleMatchSpec({
      field: "merchant_or_description",
      operator: "contains",
      value: "  Blue   Bottle  "
    });
    expect(result).toEqual({
      ok: true,
      value: { matchField: "merchant_or_description", matchOperator: "contains", pattern: "Blue Bottle" }
    });
  });

  it("rejects a missing value", () => {
    expect(parseRuleMatchSpec({ field: "merchant_or_description", operator: "contains", value: "" }).ok).toBe(false);
    expect(parseRuleMatchSpec({ field: "merchant_or_description", operator: "contains", value: null }).ok).toBe(false);
  });

  it("rejects an invalid field", () => {
    const result = parseRuleMatchSpec({ field: "amount", operator: "contains", value: "x" });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid operator", () => {
    const result = parseRuleMatchSpec({ field: "merchant_or_description", operator: "startswith", value: "x" });
    expect(result.ok).toBe(false);
  });
});
