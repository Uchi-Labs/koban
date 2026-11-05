import { NextRequest, NextResponse } from "next/server";
import { errorResponse, unknownCursorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { applyBudgetOverrides, getCategoryBudgetOverrides, setCategoryBudgetOverride } from "@/lib/category-budgets";
import { resolveCategoryEmoji } from "@/lib/category-suggestions";
import { createCategory } from "@/lib/db/finance-db";
import { categoryRollups, paginateById, parseListParams, serializeCategory } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const [{ categories: rawCategories, transactions }, overrides] = await Promise.all([
    getFinanceData(),
    getCategoryBudgetOverrides()
  ]);
  const categories = applyBudgetOverrides(rawCategories, overrides);
  const includeEmpty = request.nextUrl.searchParams.get("include_empty") === "true";
  const includeArchived = request.nextUrl.searchParams.get("include_archived") === "true";
  const { limit, startingAfter } = parseListParams(request.nextUrl.searchParams, 100);
  const rows = categoryRollups(categories, transactions)
    .filter((row) => includeArchived || !row.category.archived)
    .filter((row) => includeEmpty || row.transactionCount > 0)
    .sort((left, right) => left.category.sortOrder - right.category.sortOrder);
  const serialized = rows.map((row) => serializeCategory(row.category, row.transactionCount, row.spending));

  try {
    return NextResponse.json(paginateById(serialized, { limit, startingAfter }));
  } catch (error) {
    return unknownCursorResponse(error) ?? Promise.reject(error);
  }
}

export async function POST(request: NextRequest) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const name = typeof parsed.body.name === "string" ? parsed.body.name : "";
  const emoji = typeof parsed.body.emoji === "string" ? parsed.body.emoji : undefined;
  const color = typeof parsed.body.color === "string" ? parsed.body.color : undefined;
  const budgetAmount =
    typeof parsed.body.budget_amount === "number" && Number.isFinite(parsed.body.budget_amount) && parsed.body.budget_amount > 0
      ? parsed.body.budget_amount
      : undefined;

  try {
    const category = await createCategory({ color, emoji: await resolveCategoryEmoji(name, emoji), name });
    if (budgetAmount !== undefined) {
      await setCategoryBudgetOverride(category.id, budgetAmount);
    }
    return NextResponse.json(serializeCategory({ ...category, budgetAmount }), { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to create category.", 400);
  }
}
