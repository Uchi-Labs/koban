import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { deleteFinancialGoal, listFinancialGoals, updateFinancialGoal } from "@/lib/db/finance-db";
import { parseGoalWriteBody, serializeGoal } from "@/lib/goals-api";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = parseGoalWriteBody(parsed.body, { requireName: false });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const updated = await updateFinancialGoal(decodeURIComponent(goalId), validation.value);

  if (!updated) {
    return NextResponse.json({ error: "Financial goal not found." }, { status: 404 });
  }

  const goals = await listFinancialGoals();
  const withStats = goals.find((goal) => goal.id === updated.id);

  return NextResponse.json(
    serializeGoal(withStats ?? { ...updated, savedAmountMinor: 0, transactionCount: 0 })
  );
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  const deleted = await deleteFinancialGoal(decodeURIComponent(goalId));

  if (!deleted) {
    return NextResponse.json({ error: "Financial goal not found." }, { status: 404 });
  }

  return NextResponse.json({
    object: "financial_goal",
    id: decodeURIComponent(goalId),
    deleted: true
  });
}
