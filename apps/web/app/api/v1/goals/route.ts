import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { createFinancialGoal, listFinancialGoals } from "@/lib/db/finance-db";
import { parseGoalWriteBody, serializeGoal } from "@/lib/goals-api";

export const runtime = "nodejs";

export async function GET() {
  const goals = await listFinancialGoals();

  return NextResponse.json({
    object: "list",
    data: goals.map(serializeGoal),
    has_more: false
  });
}

export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = parseGoalWriteBody(parsed.body, { requireName: true });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const goal = await createFinancialGoal({
    name: validation.value.name ?? "",
    emoji: validation.value.emoji ?? undefined,
    targetAmountMinor: validation.value.targetAmountMinor ?? undefined
  });

  return NextResponse.json(
    serializeGoal({ ...goal, savedAmountMinor: 0, transactionCount: 0 }),
    { status: 201 }
  );
}
