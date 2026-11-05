import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { deleteFinancialGoal, listFinancialGoals, updateFinancialGoal } from "@/lib/db/finance-db";
import { InvalidRequest, ResourceNotFound } from "@/lib/effect/errors";
import { fromPromise, handler, JsonObjectBody } from "@/lib/effect/http";
import { parseGoalWriteBody, serializeGoal } from "@/lib/goals-api";

export const runtime = "nodejs";

const GoalParams = Schema.Struct({ goalId: Schema.String });

export const PATCH = handler(
  { body: JsonObjectBody, operation: "Goals.update", params: GoalParams },
  ({ body, params }) =>
    Effect.gen(function* () {
      const id = decodeURIComponent(params.goalId);
      const validation = parseGoalWriteBody(body, { requireName: false });

      if (!validation.ok) {
        return yield* new InvalidRequest({ reason: validation.error });
      }

      const updated = yield* fromPromise("Goals.update", () => updateFinancialGoal(id, validation.value));

      if (!updated) {
        return yield* new ResourceNotFound({ id, resource: "Financial goal" });
      }

      const goals = yield* fromPromise("Goals.list", () => listFinancialGoals());
      const withStats = goals.find((goal) => goal.id === updated.id);

      return serializeGoal(withStats ?? { ...updated, savedAmountMinor: 0, transactionCount: 0 });
    })
);

export const DELETE = handler({ operation: "Goals.delete", params: GoalParams }, ({ params }) =>
  Effect.gen(function* () {
    const id = decodeURIComponent(params.goalId);
    const deleted = yield* fromPromise("Goals.delete", () => deleteFinancialGoal(id));

    if (!deleted) {
      return yield* new ResourceNotFound({ id, resource: "Financial goal" });
    }

    return { deleted: true, id, object: "financial_goal" };
  })
);
