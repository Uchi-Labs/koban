import type { ReviewContext } from "@/components/review-context-panel";
import { ReviewStack } from "@/components/review-stack";
import { listEnrichmentSuggestionItems, listReviewQueueContext } from "@/lib/db/finance-db";
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

  const context = await listReviewQueueContext(rows.map((row) => row.id));

  const categorySuggestions = suggestionItems.flatMap(({ suggestion }) =>
    suggestion.transactionId && suggestion.categoryId ? [suggestion] : []
  );
  const suggestions = Object.fromEntries(categorySuggestions.map((suggestion) => [suggestion.transactionId!, suggestion.categoryId!]));
  const confidences = Object.fromEntries(categorySuggestions.map((suggestion) => [suggestion.transactionId!, suggestion.confidence]));

  const contexts: Record<string, ReviewContext> = Object.fromEntries(
    rows.map((row) => [row.id, context.get(row.id) ?? { evidence: [], notes: [] }])
  );

  return (
    <ReviewStack
      categories={categories.filter((category) => !category.archived)}
      confidences={confidences}
      contexts={contexts}
      initialTransactions={getTransactionViews(rows, { accounts: lookups.accountById, categories: lookups.categoryById })}
      suggestions={suggestions}
    />
  );
}
