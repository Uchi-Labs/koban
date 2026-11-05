import { Search } from "lucide-react";
import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { CategoryPill } from "@/components/category-pill";
import { Input } from "@/components/ui/input";
import { PageHeader, pageFrameClassName } from "@/components/page-header";
import type { SemanticSearchResult } from "@/lib/db/finance-db";
import type { Category } from "@ai-finances/schema";

export interface SearchViewProps {
  categories: Category[];
  query: string;
  results: SemanticSearchResult[];
}

export function SearchView({ categories, query, results }: SearchViewProps) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <main className={pageFrameClassName} data-testid="semantic-search-page">
      <PageHeader
        description="Search by meaning across your transactions, linked receipts, and notes."
        title="Semantic finance search"
      />

      <form action="/search" className="flex max-w-2xl items-center gap-2">
        <label className="relative flex-1" htmlFor="semantic-search-input">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoComplete="off"
            className="h-9 pl-9"
            defaultValue={query}
            id="semantic-search-input"
            name="q"
            placeholder="Search by merchant, category, tag, amount, note, or trip context"
            type="search"
          />
        </label>
        <Button size="lg" type="submit">
          Search
        </Button>
      </form>

      <div className="flex flex-col gap-1">
        {results.map((result) => {
          const transaction = result.transaction;
          const sourceItem = result.sourceItem;
          const category = transaction ? categoryById.get(transaction.categoryId) : undefined;

          return (
            <article
              className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 text-sm transition-colors hover:bg-muted/60"
              data-testid="semantic-search-result"
              key={`${result.resourceType}:${result.resourceId}`}
            >
              <div className="min-w-0 flex-1">
                <strong className="font-medium">{result.title}</strong>
                <p className="truncate text-xs text-muted-foreground">
                  {transaction
                    ? `${transaction.date} · ${transaction.description}`
                    : sourceItem
                      ? `${sourceItem.kind.replace(/_/g, " ")} · ${sourceItem.occurredAt ?? sourceItem.sourceId}`
                      : result.resourceId}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{result.body.split("\n").slice(0, 4).join(" · ")}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] text-muted-foreground">{result.resourceType === "source_item" ? "Evidence" : "Transaction"}</span>
                <b className="text-sm font-semibold tabular-nums">{Math.round(result.score * 100)}%</b>
                {category ? <CategoryPill category={category} /> : null}
                {transaction ? <Amount amount={transaction.amount} currency={transaction.currency} /> : null}
              </div>
            </article>
          );
        })}
        {query.length === 0 ? <p className="px-1 text-sm text-muted-foreground">Describe what you&apos;re looking for, such as a merchant, a trip, or a note you wrote.</p> : null}
        {query.length > 0 && results.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">No matches for &ldquo;{query}&rdquo;. Try fewer words or a merchant name.</p>
        ) : null}
      </div>
    </main>
  );
}
