import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { setCategoryBudgetOverride } from "@/lib/category-budgets";
import { deleteCustomCategoryAndReassign, updateCategory } from "@/lib/db/finance-db";
import { InvalidRequest, ResourceNotFound } from "@/lib/effect/errors";
import { fromPromise, handler, JsonObjectBody, type LegacyCallError } from "@/lib/effect/http";
import { serializeCategory } from "@/lib/finance-api";

export const runtime = "nodejs";

const CategoryParams = Schema.Struct({ categoryId: Schema.String });

// finance-db throws plain Errors for both bad input ("System categories cannot
// be deleted.") and storage failures, so a failed write stays a 400 with the
// route's message, as before. E2's typed repository errors replace this.
const asInvalidRequest = (reason: string) => (error: LegacyCallError) =>
  Effect.logWarning(reason, error.cause).pipe(Effect.andThen(Effect.fail(new InvalidRequest({ reason }))));

export const PATCH = handler(
  { body: JsonObjectBody, operation: "Categories.update", params: CategoryParams },
  ({ body, params }) =>
    Effect.gen(function* () {
      const id = decodeURIComponent(params.categoryId);
      const hasBudget = Object.prototype.hasOwnProperty.call(body, "budget_amount");
      const rawBudget = body.budget_amount;
      const nextBudget =
        typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : null;

      const category = yield* fromPromise("Categories.update", () =>
        updateCategory(id, {
          archived: typeof body.archived === "boolean" ? body.archived : undefined,
          color: typeof body.color === "string" ? body.color : undefined,
          emoji: typeof body.emoji === "string" ? body.emoji : undefined,
          name: typeof body.name === "string" ? body.name : undefined,
          sortOrder: typeof body.sort_order === "number" ? body.sort_order : undefined
        })
      );

      if (!category) {
        return yield* new ResourceNotFound({ id, resource: "Category" });
      }

      if (hasBudget) {
        yield* fromPromise("Categories.setBudget", () => setCategoryBudgetOverride(id, nextBudget));
      }

      return serializeCategory({ ...category, budgetAmount: hasBudget ? nextBudget ?? undefined : category.budgetAmount });
    }).pipe(Effect.catchTags({ LegacyCallError: asInvalidRequest("Unable to update category.") }))
);

export const DELETE = handler(
  { body: JsonObjectBody, operation: "Categories.delete", params: CategoryParams },
  ({ body, params }) =>
    Effect.gen(function* () {
      const replacementId = typeof body.reassign_to === "string" ? body.reassign_to : "cat_other";
      const id = decodeURIComponent(params.categoryId);

      const deleted = yield* fromPromise("Categories.delete", () => deleteCustomCategoryAndReassign(id, replacementId));
      if (!deleted) {
        return yield* new ResourceNotFound({ id, resource: "Category" });
      }
      yield* fromPromise("Categories.clearBudget", () => setCategoryBudgetOverride(id, null));

      return { deleted: true, id, object: "category" };
    }).pipe(Effect.catchTags({ LegacyCallError: asInvalidRequest("Unable to delete category.") }))
);
