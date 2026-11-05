import { NextRequest, NextResponse } from "next/server";
import { unknownCursorResponse } from "@/lib/api-error";
import {
  filterTransactionsForList,
  paginateById,
  parseListParams,
  parseTransactionAmountFilters,
  parseTransactionReviewFilter,
  serializeTransaction
} from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";
import { createViewModelLookups } from "@/lib/view-models";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { accounts, categories, transactions } = await getFinanceData();
  const accountId = request.nextUrl.searchParams.get("account_id");
  const categoryId = request.nextUrl.searchParams.get("category_id");
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const reviewFilter = parseTransactionReviewFilter({
    review: request.nextUrl.searchParams.get("review"),
    reviewed: request.nextUrl.searchParams.get("reviewed")
  });
  const status = request.nextUrl.searchParams.get("status");
  const { limit, startingAfter } = parseListParams(request.nextUrl.searchParams);
  const amountFilters = parseTransactionAmountFilters(request.nextUrl.searchParams);
  const lookups = createViewModelLookups({ accounts, categories });
  const rows = filterTransactionsForList(
    transactions,
    {
      accountId,
      categoryId,
      query,
      reviewFilter,
      status,
      ...amountFilters
    },
    lookups
  );
  let page: ReturnType<typeof paginateById<(typeof rows)[number]>>;
  try {
    page = paginateById(rows, { limit, startingAfter });
  } catch (error) {
    return unknownCursorResponse(error) ?? Promise.reject(error);
  }

  return NextResponse.json({
    ...page,
    data: page.data.map((transaction) => serializeTransaction(transaction, {
      accounts: lookups.accountById,
      categories: lookups.categoryById
    })),
    total_count: rows.length
  });
}
