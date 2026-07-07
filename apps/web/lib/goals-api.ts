import type { JsonObject } from "@/lib/api-request";
import type { FinancialGoalUpdateInput, FinancialGoalWithStats } from "@/lib/db/finance-db";

/**
 * Serialize a goal (with computed stats) into the Stripe-style snake_case object.
 * `saved_amount_cents` is already sign-normalized positive by the DB layer.
 */
export function serializeGoal(goal: FinancialGoalWithStats) {
  return {
    object: "financial_goal",
    id: goal.id,
    name: goal.name,
    emoji: goal.emoji ?? null,
    target_amount_cents: goal.targetAmountMinor ?? null,
    saved_amount_cents: goal.savedAmountMinor,
    transaction_count: goal.transactionCount,
    state: goal.state,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt
  };
}

export type GoalWriteValue = FinancialGoalUpdateInput;

export type GoalWriteValidation =
  | { ok: true; value: GoalWriteValue }
  | { error: string; ok: false };

/**
 * Validate a goal create/update body. On create (`requireName`) a non-blank
 * `name` is required; malformed fields yield a deliberate 400.
 */
export function parseGoalWriteBody(body: JsonObject, { requireName }: { requireName: boolean }): GoalWriteValidation {
  const value: GoalWriteValue = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return { error: "Goal name must be a non-empty string.", ok: false };
    }

    value.name = body.name;
  } else if (requireName) {
    return { error: "Goal name is required.", ok: false };
  }

  if ("emoji" in body) {
    if (body.emoji === null) {
      value.emoji = null;
    } else if (typeof body.emoji === "string") {
      value.emoji = body.emoji;
    } else {
      return { error: "Goal emoji must be a string or null.", ok: false };
    }
  }

  const rawTarget = body.target_amount_cents ?? body.targetAmountMinor;

  if ("target_amount_cents" in body || "targetAmountMinor" in body) {
    if (rawTarget === null) {
      value.targetAmountMinor = null;
    } else if (typeof rawTarget === "number" && Number.isFinite(rawTarget)) {
      value.targetAmountMinor = rawTarget;
    } else {
      return { error: "target_amount_cents must be a number or null.", ok: false };
    }
  }

  if (body.state !== undefined) {
    if (body.state !== "active" && body.state !== "archived") {
      return { error: "Goal state must be 'active' or 'archived'.", ok: false };
    }

    value.state = body.state;
  }

  return { ok: true, value };
}
