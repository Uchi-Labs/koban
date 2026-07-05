import { NextResponse } from "next/server";
import { applyTransactionRules } from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    object: "rule_apply_result",
    ...(await applyTransactionRules())
  });
}
