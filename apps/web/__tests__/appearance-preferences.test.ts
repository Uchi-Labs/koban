import { describe, expect, it } from "vitest";
import { ACCENT_DEFAULT, parseAccent } from "@/lib/accent-color";
import { FONT_CHOICE_DEFAULT, fontChoiceStyle, parseFontChoice } from "@/lib/font-choice";

describe("appearance preferences", () => {
  it.each(["constructor", "toString", "__proto__", "unknown"])(
    "falls back for a cookie containing %s instead of a preset",
    (value) => {
      expect(parseAccent(value)).toBe(ACCENT_DEFAULT);
      expect(parseFontChoice(`${value},${value}`)).toEqual(FONT_CHOICE_DEFAULT);
    }
  );

  it("keeps valid choices and defaults only the invalid font axis", () => {
    expect(parseAccent(" rose ")).toBe("rose");
    expect(parseFontChoice(" inter , lora ")).toEqual({ body: "inter", display: "lora" });
    expect(parseFontChoice("inter,constructor")).toEqual({ body: "inter", display: FONT_CHOICE_DEFAULT.display });
  });

  it("lets Inter supply both faces without a self-referencing CSS property", () => {
    const style = fontChoiceStyle({ body: "inter", display: "inter" });
    expect(style).toBeDefined();
    for (const [property, value] of Object.entries(style ?? {})) {
      expect(value).not.toContain(`var(${property})`);
    }
  });
});
