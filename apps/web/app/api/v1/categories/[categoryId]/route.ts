import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { setCategoryBudgetOverride } from "@/lib/category-budgets";
import { updateCategory } from "@/lib/db/finance-db";
import { serializeCategory } from "@/lib/finance-api";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const id = decodeURIComponent(categoryId);
  const hasBudget = Object.prototype.hasOwnProperty.call(parsed.body, "budget_amount");
  const rawBudget = parsed.body.budget_amount;
  const nextBudget =
    typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : null;

  try {
    const category = await updateCategory(id, {
      archived: typeof parsed.body.archived === "boolean" ? parsed.body.archived : undefined,
      color: typeof parsed.body.color === "string" ? parsed.body.color : undefined,
      emoji: typeof parsed.body.emoji === "string" ? parsed.body.emoji : undefined,
      name: typeof parsed.body.name === "string" ? parsed.body.name : undefined,
      sortOrder: typeof parsed.body.sort_order === "number" ? parsed.body.sort_order : undefined
    });

    if (!category) {
      return NextResponse.json({ error: "Category not found." }, { status: 404 });
    }

    if (hasBudget) {
      await setCategoryBudgetOverride(id, nextBudget);
    }

    return NextResponse.json(serializeCategory({ ...category, budgetAmount: hasBudget ? nextBudget ?? undefined : category.budgetAmount }));
  } catch (error) {
    return errorResponse(error, "Unable to update category.", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;

  try {
    const category = await updateCategory(decodeURIComponent(categoryId), { archived: true });

    if (!category) {
      return NextResponse.json({ error: "Category not found." }, { status: 404 });
    }

    return NextResponse.json({
      deleted: true,
      id: category.id,
      object: "category"
    });
  } catch (error) {
    return errorResponse(error, "Unable to archive category.", 400);
  }
}
