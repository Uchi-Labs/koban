import type { RuleView } from "@/components/rules-panel";
import { RulesView } from "@/components/rules-view";
import { listEnrichmentSuggestionItems, listTagStyles, listTransactionRules } from "@/lib/db/finance-db";
import { getEffectiveLlmEnrichmentStatus } from "@/lib/enrichment-runs";
import { getFinanceData } from "@/lib/finance-data";

export default async function RulesPage() {
  const [financeData, rules, suggestions, provider, tagStyles] = await Promise.all([
    getFinanceData(),
    listTransactionRules(),
    listEnrichmentSuggestionItems({ limit: 20 }),
    getEffectiveLlmEnrichmentStatus(),
    listTagStyles()
  ]);

  return (
    <RulesView
      categories={financeData.categories}
      provider={{
        baseUrl: provider.baseUrl,
        configured: provider.configured,
        errorMessage: provider.errorMessage,
        model: provider.model,
        provider: provider.provider,
        status: provider.status,
        timeoutMs: provider.timeoutMs
      }}
      rules={rules.map((rule) => ({
        categoryId: rule.categoryId,
        enabled: rule.enabled,
        id: rule.id,
        lastAppliedAt: rule.lastAppliedAt,
        lastAppliedCount: rule.lastAppliedCount,
        markReviewed: rule.markReviewed,
        matchField: rule.matchField,
        matchOperator: rule.matchOperator,
        name: rule.name,
        pattern: rule.pattern,
        tags: rule.tags
      } satisfies RuleView))}
      suggestions={suggestions.map(({ suggestion, transaction }) => ({
        action: suggestion.action,
        categoryId: suggestion.categoryId,
        confidence: suggestion.confidence,
        id: suggestion.id,
        markReviewed: suggestion.markReviewed,
        reason: suggestion.reason,
        ruleName: suggestion.ruleName,
        rulePattern: suggestion.rulePattern,
        status: suggestion.status,
        tags: suggestion.tags,
        transaction: transaction
          ? {
              amount: transaction.amount,
              categoryId: transaction.categoryId,
              currency: transaction.currency,
              date: transaction.date,
              description: transaction.description,
              id: transaction.id,
              merchantName: transaction.merchantName,
              reviewed: transaction.reviewed
            }
          : undefined,
        transactionId: suggestion.transactionId
      }))}
      tagStyles={tagStyles}
    />
  );
}
