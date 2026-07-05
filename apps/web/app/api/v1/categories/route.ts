import { NextRequest, NextResponse } from "next/server";
import { categoryRollups, paginateById, parseListParams, serializeCategory } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { categories, transactions } = await getFinanceData();
  const includeEmpty = request.nextUrl.searchParams.get("include_empty") === "true";
  const { limit, startingAfter } = parseListParams(request.nextUrl.searchParams, 100);
  const rows = categoryRollups(categories, transactions)
    .filter((row) => includeEmpty || row.transactionCount > 0)
    .sort((left, right) => left.category.sortOrder - right.category.sortOrder);
  const serialized = rows.map((row) => serializeCategory(row.category, row.transactionCount, row.spending));

  return NextResponse.json(paginateById(serialized, { limit, startingAfter }));
}
