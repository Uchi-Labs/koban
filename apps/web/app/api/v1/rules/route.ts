import type { TransactionRule } from "@ai-finances/schema";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { appCategories } from "@/lib/categories";
import { createTransactionRule, listTransactionRules } from "@/lib/db/finance-db";
import { validateTransactionRuleCreateBody } from "@/lib/transaction-rule-input";

export const runtime = "nodejs";

const categoryIds = new Set(appCategories.map((category) => category.id));

export async function GET() {
  const rules = await listTransactionRules();

  return NextResponse.json({
    object: "list",
    data: rules.map(ruleToApi),
    has_more: false
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = validateTransactionRuleCreateBody(parsed.body, categoryIds);

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await createTransactionRule(validation.value);

  return NextResponse.json({
    object: "transaction_rule",
    apply_result: result.applyResult,
    rule: ruleToApi(result.rule)
  });
}

function ruleToApi(rule: TransactionRule) {
  return {
    id: rule.id,
    object: "transaction_rule",
    name: rule.name,
    enabled: rule.enabled,
    match_field: rule.matchField,
    match_operator: rule.matchOperator,
    pattern: rule.pattern,
    category_id: rule.categoryId,
    tags: rule.tags,
    mark_reviewed: rule.markReviewed,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt,
    last_applied_at: rule.lastAppliedAt,
    last_applied_count: rule.lastAppliedCount
  };
}
