import type { Category, TransactionRuleMatchField, TransactionRuleMatchOperator } from "@ai-finances/schema";
import { isTransactionRuleMatchField, isTransactionRuleMatchOperator } from "@/lib/transaction-rule-input";

export interface RuleMatchSpec {
  matchField: TransactionRuleMatchField;
  matchOperator: TransactionRuleMatchOperator;
  pattern: string;
}

export type RuleMatchSpecResult = { ok: true; value: RuleMatchSpec } | { error: string; ok: false };

const maxMatchValueLength = 200;

/**
 * Parses and validates the {field, operator, value} tuple shared by the rules
 * preview endpoint and the bulk-categorize endpoint. Keeps the field/operator
 * domain in lock-step with the rules engine via the canonical guards.
 */
export function parseRuleMatchSpec(input: { field: unknown; operator: unknown; value: unknown }): RuleMatchSpecResult {
  const pattern = typeof input.value === "string" ? input.value.trim().replace(/\s+/g, " ") : "";

  if (!pattern) {
    return { error: "Match value is required.", ok: false };
  }

  if (pattern.length > maxMatchValueLength) {
    return { error: `Match value must be ${maxMatchValueLength} characters or fewer.`, ok: false };
  }

  if (!isTransactionRuleMatchField(input.field)) {
    return { error: "Valid match field is required.", ok: false };
  }

  if (!isTransactionRuleMatchOperator(input.operator)) {
    return { error: "Valid match operator is required.", ok: false };
  }

  return {
    ok: true,
    value: { matchField: input.field, matchOperator: input.operator, pattern }
  };
}

/**
 * Derives the rule match string from a raw merchant name. Strips trailing
 * store numbers/ids that sit on a clean whitespace boundary (e.g.
 * "Starbucks 19628" -> "Starbucks", "Whole Foods #123" -> "Whole Foods"),
 * but leaves fused tokens untouched ("Sbux19628" stays as-is because there is
 * no word boundary between the letters and the digits).
 */
export function deriveRuleMatchValue(merchantName: string): string {
  const trimmed = merchantName.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return trimmed;
  }

  // Remove one or more trailing " 12345" / " #123" / " - 12" style numeric tokens,
  // then drop any separator punctuation left dangling at the end.
  const stripped = trimmed
    .replace(/(?:\s+[#-]?\d{2,})+$/u, "")
    .replace(/[\s#-]+$/u, "")
    .trim();

  // Only accept the stripped form when something meaningful remains.
  return stripped.length >= 2 ? stripped : trimmed;
}

interface ScoredCategory {
  category: Category;
  score: number;
}

/**
 * Search-first category filter for the picker: substring match plus simple
 * fuzzy prefix matching on the category name and its individual words.
 * Prefix-of-name ranks highest, then word-prefix, then loose substring.
 * An empty query returns the categories unchanged.
 */
export function filterCategories(categories: Category[], query: string): Category[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return categories;
  }

  const scored: ScoredCategory[] = [];

  for (const category of categories) {
    const name = category.name.toLowerCase();
    const words = name.split(/\s+/).filter(Boolean);
    let score = -1;

    if (name.startsWith(normalized)) {
      score = 3;
    } else if (words.some((word) => word.startsWith(normalized))) {
      score = 2;
    } else if (name.includes(normalized)) {
      score = 1;
    }

    if (score >= 0) {
      scored.push({ category, score });
    }
  }

  return scored
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.category);
}
