import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  getCategoryIdsForValidation,
  getFinancialGoalIdsForValidation,
  setTransactionFinancialGoal
} from "@/lib/db/finance-db";
import { serializeTransaction } from "@/lib/finance-api";
import { getFinanceData, updateStoredTransactionInDb } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const { accounts, categories, transactions } = await getFinanceData();
  const transaction = transactions.find((candidate) => candidate.id === decodeURIComponent(transactionId));

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found in the local Teller ledger." }, { status: 404 });
  }

  return NextResponse.json(serializeTransaction(transaction, { accounts, categories }));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as {
    category_id?: unknown;
    categoryId?: unknown;
    financial_goal_id?: unknown;
    financialGoalId?: unknown;
    notes?: unknown;
    reviewed?: unknown;
    tags?: unknown;
  };
  const update: Parameters<typeof updateStoredTransactionInDb>[1] = {};
  const categoryId = typeof body.category_id === "string" ? body.category_id : body.categoryId;
  const hasSnakeGoalKey = Object.prototype.hasOwnProperty.call(body, "financial_goal_id");
  const hasGoalKey = hasSnakeGoalKey || Object.prototype.hasOwnProperty.call(body, "financialGoalId");
  // Preserve an explicit null (unassign) — `??` would collapse it to undefined.
  const rawGoalId = hasSnakeGoalKey ? body.financial_goal_id : body.financialGoalId;

  if (Array.isArray(body.tags)) {
    update.tags = body.tags.flatMap((tag) => (typeof tag === "string" ? [tag] : []));
  }

  if (typeof body.notes === "string") {
    update.notes = body.notes;
  }

  if (typeof body.reviewed === "boolean") {
    update.reviewed = body.reviewed;
  }

  if (typeof categoryId === "string") {
    const categoryIds = await getCategoryIdsForValidation();

    if (!categoryIds.has(categoryId)) {
      return NextResponse.json({ error: "Unknown category." }, { status: 400 });
    }

    update.categoryId = categoryId;
  }

  // Validate the goal assignment before mutating anything so a bad id is a clean 400.
  let nextGoalId: string | null = null;

  if (hasGoalKey) {
    if (rawGoalId === null) {
      nextGoalId = null;
    } else if (typeof rawGoalId === "string" && rawGoalId.length > 0) {
      const goalIds = await getFinancialGoalIdsForValidation();

      if (!goalIds.has(rawGoalId)) {
        return NextResponse.json({ error: "Unknown financial goal." }, { status: 400 });
      }

      nextGoalId = rawGoalId;
    } else {
      return NextResponse.json({ error: "financial_goal_id must be a goal id string or null." }, { status: 400 });
    }
  }

  const resolvedId = decodeURIComponent(transactionId);
  let transaction = await updateStoredTransactionInDb(resolvedId, update);

  if (transaction && hasGoalKey) {
    transaction = await setTransactionFinancialGoal(resolvedId, nextGoalId);
  }

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found in the local Teller ledger." }, { status: 404 });
  }

  const { accounts, categories } = await getFinanceData();
  return NextResponse.json(serializeTransaction(transaction, { accounts, categories }));
}
