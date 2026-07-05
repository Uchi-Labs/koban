import { describe, expect, it } from "vitest";
import {
  validateTransactionRuleCreateBody,
  validateTransactionRuleUpdateBody
} from "@/lib/transaction-rule-input";

const categoryIds = new Set(["cat_food", "cat_other"]);

describe("transaction rule input validation", () => {
  it("normalizes valid create input", () => {
    const result = validateTransactionRuleCreateBody(
      {
        category_id: "cat_food",
        mark_reviewed: true,
        match_field: "merchant_or_description",
        match_operator: "contains",
        name: "  Dinner   places  ",
        pattern: "  Dinner   Place  ",
        tags: [" food ", "food", " rule:food "]
      },
      categoryIds
    );

    expect(result).toEqual({
      ok: true,
      value: {
        categoryId: "cat_food",
        enabled: true,
        markReviewed: true,
        matchField: "merchant_or_description",
        matchOperator: "contains",
        name: "Dinner places",
        pattern: "Dinner Place",
        tags: ["food", "rule:food"]
      }
    });
  });

  it("rejects broad contains rules before they can rewrite transactions", () => {
    expect(
      validateTransactionRuleCreateBody(
        {
          match_field: "merchant_or_description",
          match_operator: "contains",
          name: "Broad",
          pattern: "a"
        },
        categoryIds
      )
    ).toEqual({
      error: "Contains rule pattern must include at least two letters or numbers.",
      ok: false
    });

    expect(
      validateTransactionRuleCreateBody(
        {
          match_field: "merchant_or_description",
          match_operator: "contains",
          name: "Payment",
          pattern: "payment"
        },
        categoryIds
      )
    ).toEqual({
      error: "Contains rule pattern is too broad for automatic transaction updates.",
      ok: false
    });
  });

  it("accepts valid regex rules", () => {
    expect(
      validateTransactionRuleCreateBody(
        {
          category_id: "cat_food",
          match_field: "merchant_or_description",
          match_operator: "regex",
          name: "Amazon variants",
          pattern: "^AMZN|AMAZON"
        },
        categoryIds
      )
    ).toEqual({
      ok: true,
      value: {
        categoryId: "cat_food",
        enabled: true,
        markReviewed: false,
        matchField: "merchant_or_description",
        matchOperator: "regex",
        name: "Amazon variants",
        pattern: "^AMZN|AMAZON",
        tags: []
      }
    });
  });

  it("rejects unsafe regex rule patterns", () => {
    expect(
      validateTransactionRuleCreateBody(
        {
          match_field: "merchant_or_description",
          match_operator: "regex",
          name: "Broken regex",
          pattern: "("
        },
        categoryIds
      )
    ).toEqual({
      error: "Regex rule pattern must be a valid regular expression.",
      ok: false
    });

    expect(
      validateTransactionRuleCreateBody(
        {
          match_field: "merchant_or_description",
          match_operator: "regex",
          name: "Too long regex",
          pattern: "a".repeat(201)
        },
        categoryIds
      )
    ).toEqual({
      error: "Rule pattern must be 200 characters or fewer.",
      ok: false
    });

    expect(
      validateTransactionRuleCreateBody(
        {
          match_field: "merchant_or_description",
          match_operator: "regex",
          name: "Empty matching regex",
          pattern: ".*"
        },
        categoryIds
      )
    ).toEqual({
      error: "Regex rule pattern cannot match empty text.",
      ok: false
    });
  });

  it("rejects invalid update shapes instead of silently dropping fields", () => {
    expect(validateTransactionRuleUpdateBody({ tags: ["ok", 123] }, categoryIds)).toEqual({
      error: "Rule tags must be strings.",
      ok: false
    });
    expect(validateTransactionRuleUpdateBody({ category_id: "cat_missing" }, categoryIds)).toEqual({
      error: "Unknown category.",
      ok: false
    });
  });

  it("distinguishes clearing a rule category from omitting it", () => {
    expect(validateTransactionRuleUpdateBody({}, categoryIds)).toEqual({
      ok: true,
      value: {}
    });
    expect(validateTransactionRuleUpdateBody({ category_id: null }, categoryIds)).toEqual({
      ok: true,
      value: {
        categoryId: null
      }
    });
    expect(validateTransactionRuleUpdateBody({ category_id: "" }, categoryIds)).toEqual({
      ok: true,
      value: {
        categoryId: null
      }
    });
    expect(validateTransactionRuleUpdateBody({ category_id: "cat_food" }, categoryIds)).toEqual({
      ok: true,
      value: {
        categoryId: "cat_food"
      }
    });
  });

  it("validates partial updates against the final rule operator and pattern", () => {
    expect(
      validateTransactionRuleUpdateBody({ pattern: "a" }, categoryIds, {
        matchOperator: "equals",
        pattern: "old"
      })
    ).toEqual({
      ok: true,
      value: {
        pattern: "a"
      }
    });

    expect(
      validateTransactionRuleUpdateBody({ match_operator: "contains" }, categoryIds, {
        matchOperator: "equals",
        pattern: "payment"
      })
    ).toEqual({
      error: "Contains rule pattern is too broad for automatic transaction updates.",
      ok: false
    });
  });
});
