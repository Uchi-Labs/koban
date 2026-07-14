import { ReviewStack } from "@/components/review-stack";
import { listEnrichmentSuggestionItems } from "@/lib/db/finance-db";
import { getFinanceData } from "@/lib/finance-data";
import { isReviewActionableTransaction } from "@/lib/transaction-classification";
import { createViewModelLookups, getTransactionViews } from "@/lib/view-models";

export default async function ReviewPage() {
  const [{ accounts, categories, transactions }, suggestionItems] = await Promise.all([
    getFinanceData(),
    listEnrichmentSuggestionItems({ limit: 100, status: "pending" })
  ]);
  const lookups = createViewModelLookups({ accounts, categories });
  const rows = transactions
    .filter(isReviewActionableTransaction)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 100);
  const suggestions = Object.fromEntries(suggestionItems.flatMap(({ suggestion }) =>
    suggestion.transactionId && suggestion.categoryId ? [[suggestion.transactionId, suggestion.categoryId]] : []
  ));

  return (
    <ReviewStack
      categories={categories.filter((category) => !category.archived)}
      initialTransactions={getTransactionViews(rows, { accounts: lookups.accountById, categories: lookups.categoryById })}
      suggestions={suggestions}
    />
  );
}
