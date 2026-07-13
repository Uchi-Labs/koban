import { NextRequest, NextResponse } from "next/server";
import { paginateById, parseListParams, serializeRecurring } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";
import { createViewModelLookups } from "@/lib/view-models";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { accounts, categories, recurringItems } = await getFinanceData();
  const { limit, startingAfter } = parseListParams(request.nextUrl.searchParams, 50);
  const rows = recurringItems.sort((left, right) => left.nextDate.localeCompare(right.nextDate) || left.name.localeCompare(right.name));
  const page = paginateById(rows, { limit, startingAfter });
  const { accountById, categoryById } = createViewModelLookups({ accounts, categories });

  return NextResponse.json({
    ...page,
    data: page.data.map((item) => serializeRecurring(item, {
      accounts: accountById,
      categories: categoryById
    }))
  });
}
