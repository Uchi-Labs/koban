import { RulesPanel, type RuleView } from "@/components/rules-panel";
import { listEnrichmentSuggestionItems, listTagStyles, listTransactionRules } from "@/lib/db/finance-db";
import { getEffectiveLlmEnrichmentStatus } from "@/lib/enrichment-runs";
import { maskLlmStatusForPublicDemo } from "@/lib/public-demo";
import { getFinanceData } from "@/lib/finance-data";

export default async function RulesPage() {
  const [financeData, rules, suggestions, provider, tagStyles] = await Promise.all([
    getFinanceData(),
    listTransactionRules(),
    listEnrichmentSuggestionItems({ limit: 20 }),
    getEffectiveLlmEnrichmentStatus().then((status) => maskLlmStatusForPublicDemo(status)),
    listTagStyles()
  ]);

  return (
    <main className="flex min-h-svh flex-col" data-testid="rules-page">
      <header className="flex items-center h-14 shrink-0 border-b border-border px-6">
        <span className="text-[13px] font-semibold tracking-tight">Rules</span>
      </header>
      <RulesPanel
        categories={financeData.categories}
        initialProvider={{
          baseUrl: provider.baseUrl,
          configured: provider.configured,
          errorMessage: provider.errorMessage,
          model: provider.model,
          provider: provider.provider,
          status: provider.status,
          timeoutMs: provider.timeoutMs
        }}
        initialSuggestions={suggestions.map(({ suggestion, transaction }) => ({
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
        initialRules={rules.map((rule) => ({
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
        tagStyles={tagStyles}
      />
    </main>
  );
}
