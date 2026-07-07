import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { authenticateApiRequest } from "@/lib/auth";
import { bulkCategorizeTransactionsByMatch, getCategoryIdsForValidation } from "@/lib/db/finance-db";
import { parseRuleMatchSpec } from "@/lib/rule-match";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);

  if (!auth.authenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const spec = parseRuleMatchSpec({
    field: parsed.body.field,
    operator: parsed.body.operator,
    value: parsed.body.match
  });

  if (!spec.ok) {
    return NextResponse.json({ error: spec.error }, { status: 400 });
  }

  const categoryId = parsed.body.category_id;

  if (typeof categoryId !== "string" || !categoryId) {
    return NextResponse.json({ error: "A target category_id is required." }, { status: 400 });
  }

  const validCategoryIds = await getCategoryIdsForValidation();

  if (!validCategoryIds.has(categoryId)) {
    return NextResponse.json({ error: "Unknown category." }, { status: 400 });
  }

  const result = await bulkCategorizeTransactionsByMatch({ ...spec.value, categoryId });

  return NextResponse.json({
    object: "bulk_categorize_result",
    category_id: categoryId,
    transactions_updated: result.transactionsUpdated,
    updated_transaction_ids: result.updatedTransactionIds
  });
}
