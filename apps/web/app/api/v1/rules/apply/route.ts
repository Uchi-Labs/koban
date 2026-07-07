import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/auth";
import { applyTransactionRules } from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);

  if (!auth.authenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return NextResponse.json({
    object: "rule_apply_result",
    ...(await applyTransactionRules())
  });
}
