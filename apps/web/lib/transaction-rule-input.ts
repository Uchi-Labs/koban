import type { TransactionRuleMatchField, TransactionRuleMatchOperator } from "@ai-finances/schema";

const transactionRuleMatchFields = new Set<TransactionRuleMatchField>([
  "description",
  "merchant_name",
  "merchant_or_description"
]);
const transactionRuleMatchOperators = new Set<TransactionRuleMatchOperator>(["contains", "equals", "regex"]);

const maxRuleNameLength = 80;
const maxRulePatternLength = 200;
const maxRuleTags = 20;
const maxRuleTagLength = 32;
const broadContainsPatterns = new Set([
  "ach",
  "card",
  "charge",
  "credit",
  "debit",
  "online",
  "payment",
  "purchase",
  "transaction",
  "transfer",
  "withdrawal"
]);

export interface ValidatedTransactionRuleInput {
  categoryId?: string;
  enabled?: boolean;
  markReviewed?: boolean;
  matchField: TransactionRuleMatchField;
  matchOperator: TransactionRuleMatchOperator;
  name: string;
  pattern: string;
  tags: string[];
}

export interface ValidatedTransactionRuleUpdate {
  categoryId?: string | null;
  enabled?: boolean;
  markReviewed?: boolean;
  matchField?: TransactionRuleMatchField;
  matchOperator?: TransactionRuleMatchOperator;
  name?: string;
  pattern?: string;
  tags?: string[];
}

export type RuleValidationResult<T> = { ok: true; value: T } | { error: string; ok: false };

export function validateTransactionRuleCreateBody(
  body: Record<string, unknown>,
  validCategoryIds: Set<string>
): RuleValidationResult<ValidatedTransactionRuleInput> {
  const name = normalizeRuleText(typeof body.name === "string" ? body.name : "");
  const pattern = normalizeRuleText(typeof body.pattern === "string" ? body.pattern : "");
  const matchField = body.match_field;
  const matchOperator = body.match_operator;

  if (!name) {
    return { error: "Rule name is required.", ok: false };
  }

  const nameError = validateRuleName(name);
  if (nameError) {
    return { error: nameError, ok: false };
  }

  if (!pattern) {
    return { error: "Rule pattern is required.", ok: false };
  }

  if (typeof matchField !== "string" || !transactionRuleMatchFields.has(matchField as TransactionRuleMatchField)) {
    return { error: "Valid match field is required.", ok: false };
  }

  if (
    typeof matchOperator !== "string" ||
    !transactionRuleMatchOperators.has(matchOperator as TransactionRuleMatchOperator)
  ) {
    return { error: "Valid match operator is required.", ok: false };
  }

  const patternError = validateRulePattern(pattern, matchOperator as TransactionRuleMatchOperator);
  if (patternError) {
    return { error: patternError, ok: false };
  }

  const category = validateCategoryId(body.category_id, validCategoryIds);
  if (!category.ok) {
    return category;
  }

  const tags = validateRuleTags(body.tags, false);
  if (!tags.ok) {
    return tags;
  }

  return {
    ok: true,
    value: {
      categoryId: category.value,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      markReviewed: typeof body.mark_reviewed === "boolean" ? body.mark_reviewed : false,
      matchField: matchField as TransactionRuleMatchField,
      matchOperator: matchOperator as TransactionRuleMatchOperator,
      name,
      pattern,
      tags: tags.value ?? []
    }
  };
}

export function validateTransactionRuleUpdateBody(
  body: Record<string, unknown>,
  validCategoryIds: Set<string>,
  currentRule?: {
    matchOperator?: TransactionRuleMatchOperator;
    pattern?: string;
  }
): RuleValidationResult<ValidatedTransactionRuleUpdate> {
  const update: ValidatedTransactionRuleUpdate = {};
  let nextMatchOperator = currentRule?.matchOperator;
  let nextPattern = currentRule?.pattern;

  if ("name" in body) {
    if (typeof body.name !== "string") {
      return { error: "Rule name must be a string.", ok: false };
    }

    const name = normalizeRuleText(body.name);
    if (!name) {
      return { error: "Rule name cannot be empty.", ok: false };
    }

    const nameError = validateRuleName(name);
    if (nameError) {
      return { error: nameError, ok: false };
    }

    update.name = name;
  }

  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") {
      return { error: "Rule enabled value must be boolean.", ok: false };
    }

    update.enabled = body.enabled;
  }

  if ("mark_reviewed" in body) {
    if (typeof body.mark_reviewed !== "boolean") {
      return { error: "Rule review value must be boolean.", ok: false };
    }

    update.markReviewed = body.mark_reviewed;
  }

  if ("match_field" in body) {
    if (typeof body.match_field !== "string" || !transactionRuleMatchFields.has(body.match_field as TransactionRuleMatchField)) {
      return { error: "Valid match field is required.", ok: false };
    }

    update.matchField = body.match_field as TransactionRuleMatchField;
  }

  if ("match_operator" in body) {
    if (
      typeof body.match_operator !== "string" ||
      !transactionRuleMatchOperators.has(body.match_operator as TransactionRuleMatchOperator)
    ) {
      return { error: "Valid match operator is required.", ok: false };
    }

    nextMatchOperator = body.match_operator as TransactionRuleMatchOperator;
    update.matchOperator = nextMatchOperator;
  }

  if ("pattern" in body) {
    if (typeof body.pattern !== "string") {
      return { error: "Rule pattern must be a string.", ok: false };
    }

    const pattern = normalizeRuleText(body.pattern);
    if (!pattern) {
      return { error: "Rule pattern cannot be empty.", ok: false };
    }

    nextPattern = pattern;
    update.pattern = pattern;
  }

  if (("pattern" in body || "match_operator" in body) && nextPattern) {
    const patternError = validateRulePattern(nextPattern, nextMatchOperator ?? "contains");
    if (patternError) {
      return { error: patternError, ok: false };
    }
  }

  if ("category_id" in body) {
    const category = validateCategoryIdUpdate(body.category_id, validCategoryIds);
    if (!category.ok) {
      return category;
    }

    update.categoryId = category.value;
  }

  if ("tags" in body) {
    const tags = validateRuleTags(body.tags, true);
    if (!tags.ok) {
      return tags;
    }

    update.tags = tags.value;
  }

  return { ok: true, value: update };
}

function validateRuleName(name: string): string | undefined {
  return name.length > maxRuleNameLength ? `Rule name must be ${maxRuleNameLength} characters or fewer.` : undefined;
}

function validateRulePattern(pattern: string, operator: TransactionRuleMatchOperator): string | undefined {
  if (pattern.length > maxRulePatternLength) {
    return `Rule pattern must be ${maxRulePatternLength} characters or fewer.`;
  }

  if (operator === "regex") {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "iu");
    } catch {
      return "Regex rule pattern must be a valid regular expression.";
    }

    if (regex.test("")) {
      return "Regex rule pattern cannot match empty text.";
    }

    return undefined;
  }

  const compactPattern = pattern.toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (!compactPattern) {
    return "Rule pattern must include at least one letter or number.";
  }

  if (operator === "contains") {
    if (compactPattern.length < 2) {
      return "Contains rule pattern must include at least two letters or numbers.";
    }

    if (broadContainsPatterns.has(compactPattern)) {
      return "Contains rule pattern is too broad for automatic transaction updates.";
    }
  }

  return undefined;
}

function validateCategoryId(value: unknown, validCategoryIds: Set<string>): RuleValidationResult<string | undefined> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "string" || !validCategoryIds.has(value)) {
    return { error: "Unknown category.", ok: false };
  }

  return { ok: true, value };
}

function validateCategoryIdUpdate(value: unknown, validCategoryIds: Set<string>): RuleValidationResult<string | null | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null || value === "") {
    return { ok: true, value: null };
  }

  if (typeof value !== "string" || !validCategoryIds.has(value)) {
    return { error: "Unknown category.", ok: false };
  }

  return { ok: true, value };
}

function validateRuleTags(value: unknown, requiredArray: boolean): RuleValidationResult<string[] | undefined> {
  if (value === undefined) {
    return requiredArray ? { ok: true, value: [] } : { ok: true, value: undefined };
  }

  if (!Array.isArray(value)) {
    return { error: "Rule tags must be an array of strings.", ok: false };
  }

  if (value.length > maxRuleTags) {
    return { error: `Rules can have at most ${maxRuleTags} tags.`, ok: false };
  }

  const tags: string[] = [];

  for (const rawTag of value) {
    if (typeof rawTag !== "string") {
      return { error: "Rule tags must be strings.", ok: false };
    }

    const tag = normalizeRuleText(rawTag);

    if (!tag) {
      continue;
    }

    if (tag.length > maxRuleTagLength) {
      return { error: `Rule tags must be ${maxRuleTagLength} characters or fewer.`, ok: false };
    }

    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return { ok: true, value: tags };
}

function normalizeRuleText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
