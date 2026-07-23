import { describe, expect, it } from "vitest";
import { categoryColorPalette } from "@/lib/category-style";
import { RING_COLOR_DOTS } from "@/lib/ring-color";

describe("RING_COLOR_DOTS", () => {
  it("keeps every persisted category color as an outer-ring anchor", () => {
    const outerColors = RING_COLOR_DOTS.filter((dot) => dot.ring === "outer").map((dot) => dot.color);

    expect(outerColors).toEqual([...categoryColorPalette]);
  });

  it("emits valid six-digit hex values for every selectable dot", () => {
    expect(RING_COLOR_DOTS.every((dot) => /^#[0-9a-f]{6}$/i.test(dot.hex))).toBe(true);
  });
});
