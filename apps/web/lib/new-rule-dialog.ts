export type RuleDialogMode = "exact" | "partial";
export type RuleDialogOperator = "contains" | "equals";

export function operatorForRuleDialogMode(mode: RuleDialogMode): RuleDialogOperator {
  return mode === "exact" ? "equals" : "contains";
}

export function buildRulePreviewParams({
  operator,
  pattern
}: {
  operator: RuleDialogOperator;
  pattern: string;
}): URLSearchParams {
  return new URLSearchParams({
    field: "merchant_or_description",
    operator,
    value: pattern.trim()
  });
}

export function rulePreviewKey(operator: RuleDialogOperator, pattern: string): string {
  return `${operator}\u0000${pattern.trim()}`;
}
