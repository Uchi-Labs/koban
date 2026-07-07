import { describe, expect, it } from "vitest";
import {
  ARC_END_DEG,
  ARC_START_DEG,
  INNER_PETALS,
  OUTER_PETALS,
  PETAL_HUES,
  arcAngleForT,
  hexToRgb,
  hslToHex,
  isValidHex,
  nearestPetalIndex,
  normalizeHex,
  oklchToHex,
  petalHex,
  shadeColor,
  tForArcAngle
} from "@/lib/bloom-color";

describe("normalizeHex / isValidHex", () => {
  it("expands 3-digit hex and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("abc")).toBe("#aabbcc");
  });

  it("accepts 6-digit hex with or without hash", () => {
    expect(normalizeHex("#F7C13F")).toBe("#f7c13f");
    expect(normalizeHex("f7c13f")).toBe("#f7c13f");
  });

  it("rejects invalid input", () => {
    expect(normalizeHex("nope")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("oklch(0.72 0.13 162)")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(isValidHex("#fff")).toBe(true);
    expect(isValidHex("#gggggg")).toBe(false);
  });
});

describe("hslToHex / hexToRgb round trips", () => {
  it("converts pure red", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
  });

  it("converts pure green and blue", () => {
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
  });

  it("parses hex back to rgb", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("garbage")).toBeNull();
  });
});

describe("shadeColor", () => {
  it("returns black at the tail", () => {
    expect(shadeColor("#3388ff", 1)).toBe("#000000");
  });

  it("returns roughly the base hue at the midpoint", () => {
    expect(shadeColor("#3388ff", 0.5)).toBe("#3388ff");
  });

  it("lightens toward the top", () => {
    const light = shadeColor("#3388ff", 0);
    const rgb = hexToRgb(light);
    expect(rgb).not.toBeNull();
    // Mixed heavily toward white, so every channel is brighter than the base.
    expect(rgb!.r).toBeGreaterThan(0x33);
    expect(rgb!.g).toBeGreaterThan(0x88);
    expect(rgb!.b).toBeGreaterThanOrEqual(0xff - 1);
  });

  it("darkens monotonically from midpoint to tail", () => {
    const mid = hexToRgb(shadeColor("#3388ff", 0.5))!;
    const darker = hexToRgb(shadeColor("#3388ff", 0.75))!;
    expect(darker.r).toBeLessThan(mid.r);
    expect(darker.b).toBeLessThan(mid.b);
  });
});

describe("oklchToHex", () => {
  it("converts the legacy mint category color to a green-dominant hex", () => {
    const hex = oklchToHex("oklch(0.72 0.13 162)");
    expect(hex).not.toBeNull();
    expect(isValidHex(hex!)).toBe(true);
    const rgb = hexToRgb(hex!)!;
    expect(rgb.g).toBeGreaterThan(rgb.r);
    expect(rgb.g).toBeGreaterThan(rgb.b);
  });

  it("converts a blue oklch to a blue-dominant hex", () => {
    const rgb = hexToRgb(oklchToHex("oklch(0.62 0.16 245)")!)!;
    expect(rgb.b).toBeGreaterThan(rgb.r);
    expect(rgb.b).toBeGreaterThan(rgb.g);
  });

  it("ignores a trailing alpha and accepts percentage lightness", () => {
    expect(oklchToHex("oklch(72% 0.13 162 / 55%)")).not.toBeNull();
  });

  it("returns null for non-oklch input", () => {
    expect(oklchToHex("#ffffff")).toBeNull();
    expect(oklchToHex("rgb(1,2,3)")).toBeNull();
  });
});

describe("petal set", () => {
  it("has 15 petals: 9 outer + 6 inner", () => {
    expect(PETAL_HUES).toHaveLength(15);
    expect(OUTER_PETALS).toHaveLength(9);
    expect(INNER_PETALS).toHaveLength(6);
  });

  it("produces valid hex for every petal", () => {
    for (const petal of PETAL_HUES) {
      expect(isValidHex(petalHex(petal))).toBe(true);
    }
  });

  it("finds the nearest petal by hue", () => {
    // A saturated mint should map to the mint-ish inner petal (h ~168).
    const index = nearestPetalIndex(hslToHex(168, 0.5, 0.62));
    expect(PETAL_HUES[index].h).toBeGreaterThan(140);
    expect(PETAL_HUES[index].h).toBeLessThan(200);
  });
});

describe("arc geometry", () => {
  it("maps t across the sweep and clamps", () => {
    expect(arcAngleForT(0)).toBe(ARC_START_DEG);
    expect(arcAngleForT(1)).toBe(ARC_END_DEG);
    expect(arcAngleForT(-5)).toBe(ARC_START_DEG);
    expect(arcAngleForT(5)).toBe(ARC_END_DEG);
  });

  it("is the inverse of tForArcAngle", () => {
    const mid = (ARC_START_DEG + ARC_END_DEG) / 2;
    expect(tForArcAngle(mid)).toBeCloseTo(0.5, 5);
    expect(tForArcAngle(arcAngleForT(0.3))).toBeCloseTo(0.3, 5);
  });

  it("is monotonic in t", () => {
    expect(arcAngleForT(0.2)).toBeLessThan(arcAngleForT(0.8));
  });
});
