import { TransactionsView } from "@/components/transactions-view";
import { getFinanceData } from "@/lib/finance-data";
import { getTransactionViews } from "@/lib/view-models";

export default async function TransactionsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accounts, categories, transactions } = await getFinanceData();
  const params = searchParams ? await searchParams : {};
  const reviewFilter = reviewFilterFromParams(firstParam(params.review), firstParam(params.reviewed));

  return (
    <TransactionsView
      categories={categories}
      initialAccountId={firstParam(params.account_id)}
      initialCategoryId={firstParam(params.category_id)}
      initialQuery={firstParam(params.q)}
      initialReviewFilter={reviewFilter}
      initialTab={tabFromParams(firstParam(params.tab), reviewFilter)}
      transactions={getTransactionViews(transactions, { accounts, categories })}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
