import type { TransactionRule } from "@ai-finances/schema";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { appCategories } from "@/lib/categories";
import { deleteTransactionRule, getTransactionRule, updateTransactionRule } from "@/lib/db/finance-db";
import { validateTransactionRuleUpdateBody } from "@/lib/transaction-rule-input";

export const runtime = "nodejs";

const categoryIds = new Set(appCategories.map((category) => category.id));

export async function PATCH(request: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  const decodedRuleId = decodeURIComponent(ruleId);
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const existing = await getTransactionRule(decodedRuleId);

  if (!existing) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  const validation = validateTransactionRuleUpdateBody(parsed.body, categoryIds, {
    matchOperator: existing.matchOperator,
    pattern: existing.pattern
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await updateTransactionRule(decodedRuleId, validation.value);

  if (!result) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  return NextResponse.json({
    object: "transaction_rule",
    apply_result: result.applyResult,
    rule: ruleToApi(result.rule)
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  const deleted = await deleteTransactionRule(decodeURIComponent(ruleId));

  if (!deleted) {
    return NextResponse.json({ error: "Rule not found." }, { status: 404 });
  }

  return NextResponse.json({
    deleted: true,
    id: decodeURIComponent(ruleId),
    object: "transaction_rule"
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
