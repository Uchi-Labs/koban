import { describe, expect, it } from "vitest";
import { categoryColorPalette, inferCategoryEmoji, isValidCssColor, neutralCategoryEmoji } from "@/lib/category-style";

describe("category style helpers", () => {
  it("assigns deterministic emoji for common finance category names", () => {
    expect(inferCategoryEmoji("Groceries")).toBe("🛒");
    expect(inferCategoryEmoji("Travel & vacation")).toBe("✈️");
    expect(inferCategoryEmoji("Rent")).toBe("🏠");
    expect(inferCategoryEmoji("Software subscriptions")).toBe("💻");
    expect(inferCategoryEmoji("Unmapped category")).toBe(neutralCategoryEmoji);
  });
});

// `isValidCssColor` is the trust boundary for user-picked category/tag colors before
// they land in inline styles (backgroundColor, color-mix, box-shadow) — this must
// accept every real shape the BloomColorPicker and hand-typed input can produce, and
// reject anything that isn't a structurally well-formed hex/rgb/hsl/oklch/oklab value.
describe("isValidCssColor", () => {
  it("accepts every existing categoryColorPalette token", () => {
    for (const color of categoryColorPalette) {
      expect(isValidCssColor(color)).toBe(true);
    }
  });

  it("accepts 3- and 6-digit hex colors", () => {
    expect(isValidCssColor("#8B5CF6")).toBe(true);
    expect(isValidCssColor("#8b5cf6")).toBe(true);
    expect(isValidCssColor("#fff")).toBe(true);
    expect(isValidCssColor("#FfF")).toBe(true);
  });

  it("accepts rgb()/rgba() with numeric or percentage channels", () => {
    expect(isValidCssColor("rgb(139, 92, 246)")).toBe(true);
    expect(isValidCssColor("rgb(139 92 246)")).toBe(true);
    expect(isValidCssColor("rgba(139, 92, 246, 0.5)")).toBe(true);
    expect(isValidCssColor("rgb(50% 20% 90%)")).toBe(true);
  });

  it("accepts hsl()/hsla() with an angle hue and percentage saturation/lightness", () => {
    expect(isValidCssColor("hsl(262, 83%, 66%)")).toBe(true);
    expect(isValidCssColor("hsl(262deg 83% 66%)")).toBe(true);
    expect(isValidCssColor("hsla(262, 83%, 66%, 0.4)")).toBe(true);
  });

  it("accepts oklch() and oklab() with numeric args and an optional alpha", () => {
    expect(isValidCssColor("oklch(0.6 0.2 45)")).toBe(true);
    expect(isValidCssColor("oklch(60% 0.2 45deg)")).toBe(true);
    expect(isValidCssColor("oklch(0.6 0.2 45 / 0.5)")).toBe(true);
    expect(isValidCssColor("oklab(0.6 -0.1 0.15)")).toBe(true);
  });

  it("rejects named colors, CSS functions, and hostile/malformed strings", () => {
    expect(isValidCssColor("red")).toBe(false);
    expect(isValidCssColor("var(--foreground)")).toBe(false);
    expect(isValidCssColor("url(javascript:alert(1))")).toBe(false);
    expect(isValidCssColor("calc(1 + 1)")).toBe(false);
    expect(isValidCssColor("red;background:url(x)")).toBe(false);
    expect(isValidCssColor("oklch(0.6 0.2 45); } body { display: none")).toBe(false);
    expect(isValidCssColor("javascript:alert(1)")).toBe(false);
    expect(isValidCssColor("")).toBe(false);
    expect(isValidCssColor(undefined)).toBe(false);
    expect(isValidCssColor(null)).toBe(false);
    expect(isValidCssColor("#12345")).toBe(false);
    expect(isValidCssColor("#gggggg")).toBe(false);
  });
});
