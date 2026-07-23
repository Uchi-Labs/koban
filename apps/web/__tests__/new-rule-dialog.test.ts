import { describe, expect, it } from "vitest";
import {
  buildRulePreviewParams,
  operatorForRuleDialogMode,
  rulePreviewKey
} from "@/lib/new-rule-dialog";

describe("new rule dialog preview params", () => {
  it("maps Partial to contains and Exact to equals", () => {
    expect(operatorForRuleDialogMode("partial")).toBe("contains");
    expect(operatorForRuleDialogMode("exact")).toBe("equals");
  });

  it("builds preview params from the selected operator and edited pattern", () => {
    const params = buildRulePreviewParams({
      operator: operatorForRuleDialogMode("exact"),
      pattern: "  Blue Bottle #42  "
    });

    expect(Object.fromEntries(params)).toEqual({
      field: "merchant_or_description",
      operator: "equals",
      value: "Blue Bottle #42"
    });
  });

  it("keys preview results by both operator and normalized pattern", () => {
    expect(rulePreviewKey("contains", "  Target ")).toBe(rulePreviewKey("contains", "Target"));
    expect(rulePreviewKey("contains", "Target")).not.toBe(rulePreviewKey("equals", "Target"));
  });
});
