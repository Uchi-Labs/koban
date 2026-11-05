import type { TransactionRule } from "@ai-finances/schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { deleteTransactionRule, getCategoryIdsForValidation, getTransactionRule, updateTransactionRule } from "@/lib/db/finance-db";
import { InvalidRequest, ResourceNotFound } from "@/lib/effect/errors";
import { fromPromise, handler, JsonObjectBody } from "@/lib/effect/http";
import { validateTransactionRuleUpdateBody } from "@/lib/transaction-rule-input";

export const runtime = "nodejs";

const RuleParams = Schema.Struct({ ruleId: Schema.String });

export const PATCH = handler(
  { body: JsonObjectBody, operation: "Rules.update", params: RuleParams },
  ({ body, params }) =>
    Effect.gen(function* () {
      const id = decodeURIComponent(params.ruleId);
      const existing = yield* fromPromise("Rules.get", () => getTransactionRule(id));

      if (!existing) {
        return yield* new ResourceNotFound({ id, resource: "Rule" });
      }

      const categoryIds = yield* fromPromise("Rules.categoryIds", () => getCategoryIdsForValidation());
      const validation = validateTransactionRuleUpdateBody(body, categoryIds, {
        matchOperator: existing.matchOperator,
        pattern: existing.pattern
      });

      if (!validation.ok) {
        return yield* new InvalidRequest({ reason: validation.error });
      }

      const result = yield* fromPromise("Rules.update", () => updateTransactionRule(id, validation.value));

      if (!result) {
        return yield* new ResourceNotFound({ id, resource: "Rule" });
      }

      return {
        object: "transaction_rule",
        apply_result: result.applyResult,
        rule: ruleToApi(result.rule)
      };
    })
);

export const DELETE = handler({ operation: "Rules.delete", params: RuleParams }, ({ params }) =>
  Effect.gen(function* () {
    const id = decodeURIComponent(params.ruleId);
    const deleted = yield* fromPromise("Rules.delete", () => deleteTransactionRule(id));

    if (!deleted) {
      return yield* new ResourceNotFound({ id, resource: "Rule" });
    }

    return { deleted: true, id, object: "transaction_rule" };
  })
);

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
