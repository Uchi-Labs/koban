import { NextRequest, NextResponse } from "next/server";
import {
  paginateById,
  parseListParams,
  parseTransactionReviewFilter,
  serializeTransaction,
  transactionMatchesQuery,
  transactionMatchesReviewFilter
} from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

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
  const rows = transactions
    .filter((transaction) => (accountId ? transaction.accountId === accountId : true))
    .filter((transaction) => (categoryId ? transaction.categoryId === categoryId : true))
    .filter((transaction) => (status ? transaction.status === status : true))
    .filter((transaction) => transactionMatchesReviewFilter(transaction, reviewFilter))
    .filter((transaction) => transactionMatchesQuery(transaction, query))
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const page = paginateById(rows, { limit, startingAfter });

  return NextResponse.json({
    ...page,
    data: page.data.map((transaction) => serializeTransaction(transaction, { accounts, categories }))
  });
}
