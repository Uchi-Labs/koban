import type { Category, TagStyle } from "@ai-finances/schema";
import {
  RulesPanel,
  type EnrichmentProviderView,
  type EnrichmentSuggestionView,
  type RuleView
} from "@/components/rules-panel";
import { PageHeader, pageFrameClassName } from "@/components/page-header";

export interface RulesViewProps {
  categories: Category[];
  provider: EnrichmentProviderView;
  rules: RuleView[];
  suggestions: EnrichmentSuggestionView[];
  tagStyles: TagStyle[];
}

export function RulesView({ categories, provider, rules, suggestions, tagStyles }: RulesViewProps) {
  return (
    <main className={pageFrameClassName} data-testid="rules-page">
      <PageHeader description="Categorize and tag transactions automatically, by merchant or description." title="Rules" />
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
