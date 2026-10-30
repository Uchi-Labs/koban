import type { Category, TagStyle } from "@ai-finances/schema";
import {
  RulesPanel,
  type EnrichmentProviderView,
  type EnrichmentSuggestionView,
  type RuleView
} from "@/components/rules-panel";

export interface RulesViewProps {
  categories: Category[];
  provider: EnrichmentProviderView;
  rules: RuleView[];
  suggestions: EnrichmentSuggestionView[];
  tagStyles: TagStyle[];
}

export function RulesView({ categories, provider, rules, suggestions, tagStyles }: RulesViewProps) {
  return (
    <main className="flex min-h-svh flex-col" data-testid="rules-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Rules</span>
      </header>
      <RulesPanel
        categories={categories}
        initialProvider={provider}
        initialSuggestions={suggestions}
        initialRules={rules}
        tagStyles={tagStyles}
      />
    </main>
  );
}
