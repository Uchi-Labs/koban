import { NextRequest, NextResponse } from "next/server";
import { transactionMatchesRulePattern } from "@/lib/db/finance-db";
import { serializeTransaction } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";
import { parseRuleMatchSpec } from "@/lib/rule-match";

export const runtime = "nodejs";

const previewLimit = 50;

export async function GET(request: NextRequest) {
  const spec = parseRuleMatchSpec({
    field: request.nextUrl.searchParams.get("field"),
    operator: request.nextUrl.searchParams.get("operator"),
    value: request.nextUrl.searchParams.get("value")
  });

  if (!spec.ok) {
    return NextResponse.json({ error: spec.error }, { status: 400 });
  }

  const { accounts, categories, transactions } = await getFinanceData();
  const matched = transactions.filter((transaction) => transactionMatchesRulePattern(transaction, spec.value));
  const data = matched
    .slice(0, previewLimit)
    .map((transaction) => serializeTransaction(transaction, { accounts, categories }));

  return NextResponse.json({
    object: "list",
    data,
    has_more: matched.length > previewLimit,
    total_count: matched.length
  });
}
