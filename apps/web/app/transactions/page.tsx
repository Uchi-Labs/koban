import { TransactionsView } from "@/components/transactions-view";
import {
  filterTransactionsForList,
  paginateById,
  parseTransactionAmountFilters
} from "@/lib/finance-api";
import { listTagStyles } from "@/lib/db/finance-db";
import { getFinanceData } from "@/lib/finance-data";
import { createViewModelLookups, getTransactionViews } from "@/lib/view-models";

const initialTransactionWindowSize = 200;

export default async function TransactionsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ accounts, categories, transactions }, tagStyles] = await Promise.all([getFinanceData(), listTagStyles()]);
  const params = searchParams ? await searchParams : {};
  const urlSearchParams = searchParamsToUrlSearchParams(params);
  const reviewFilter = reviewFilterFromParams(firstParam(params.review), firstParam(params.reviewed));
  const amountFilters = parseTransactionAmountFilters(urlSearchParams);
  const accountId = firstParam(params.account_id);
  const categoryId = firstParam(params.category_id);
  const query = firstParam(params.q);
  const transactionId = firstParam(params.transaction_id);
  const lookups = createViewModelLookups({ accounts, categories });
  let transactionRows = filterTransactionsForList(
    transactions,
    {
      accountId,
      categoryId,
      query,
      reviewFilter,
      ...amountFilters
    },
    lookups
  );
  const selectedRowIndex = transactionId
    ? transactionRows.findIndex((transaction) => transaction.id === transactionId)
    : -1;

  if (selectedRowIndex > 0) {
    const selectedRow = transactionRows[selectedRowIndex]!;
    transactionRows = [selectedRow, ...transactionRows.slice(0, selectedRowIndex), ...transactionRows.slice(selectedRowIndex + 1)];
  }
  const reviewRows = filterTransactionsForList(
    transactions,
    {
      accountId,
      categoryId,
      query,
      reviewFilter: "actionable",
      ...amountFilters
    },
    lookups
  );
  const transactionPage = paginateById(transactionRows, { limit: initialTransactionWindowSize });
  const reviewPage = paginateById(reviewRows, { limit: initialTransactionWindowSize });

  return (
    <TransactionsView
      categories={categories}
      initialAccountId={accountId}
      initialCategoryId={categoryId}
      initialMaxAmount={firstParam(params.max_amount)}
      initialMinAmount={firstParam(params.min_amount)}
      initialQuery={query}
      initialReviewFilter={reviewFilter}
      initialTab={tabFromParams(firstParam(params.tab), reviewFilter)}
      initialSelectedTransactionId={transactionId}
      reviewTotalCount={reviewRows.length}
      reviewTransactions={getTransactionViews(reviewPage.data, {
        accounts: lookups.accountById,
        categories: lookups.categoryById
      })}
      reviewTransactionsHasMore={reviewPage.has_more}
      tagStyles={tagStyles}
      transactionWindowSize={initialTransactionWindowSize}
      transactions={getTransactionViews(transactionPage.data, {
        accounts: lookups.accountById,
        categories: lookups.categoryById
      })}
      transactionsHasMore={transactionPage.has_more}
      windowed
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function searchParamsToUrlSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const result = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const firstValue = firstParam(value);

    if (firstValue !== undefined) {
      result.set(key, firstValue);
    }
  }

  return result;
}

function reviewFilterFromParams(review: string | undefined, reviewed: string | undefined) {
  const value = (review ?? reviewed ?? "").toLowerCase();

  if (value === "actionable" || value === "needs_review" || value === "unreviewed" || value === "false") {
    return "actionable";
  }

  if (value === "reviewed" || value === "true") {
    return "reviewed";
  }

  return "all";
}

function tabFromParams(tab: string | undefined, reviewFilter: "actionable" | "all" | "reviewed"): "all" | "review" {
  if ((tab ?? "").toLowerCase() === "review") {
    return "review";
  }

  return reviewFilter === "actionable" ? "review" : "all";
}
