import type { EnrichmentSuggestion, Transaction } from "@ai-finances/schema";

export function suggestionToApi(suggestion: EnrichmentSuggestion, transaction?: Transaction) {
  return {
    id: suggestion.id,
    object: "enrichment_suggestion",
    transaction_id: suggestion.transactionId,
    action: suggestion.action,
    status: suggestion.status,
    confidence: suggestion.confidence,
    category_id: suggestion.categoryId,
    tags: suggestion.tags,
    rule_name: suggestion.ruleName,
    rule_match_field: suggestion.ruleMatchField,
    rule_match_operator: suggestion.ruleMatchOperator,
    rule_pattern: suggestion.rulePattern,
    mark_reviewed: suggestion.markReviewed,
    reason: suggestion.reason,
    source: suggestion.source,
    created_at: suggestion.createdAt,
    updated_at: suggestion.updatedAt,
    applied_at: suggestion.appliedAt,
    transaction: transaction
      ? {
          id: transaction.id,
          date: transaction.date,
          merchant_name: transaction.merchantName,
          description: transaction.description,
          amount: transaction.amount,
          currency: transaction.currency,
          category_id: transaction.categoryId,
          reviewed: transaction.reviewed,
          status: transaction.status,
          tags: transaction.tags
        }
      : undefined
  };
}
