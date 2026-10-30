import { Search } from "lucide-react";
import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { CategoryPill } from "@/components/category-pill";
import { Input } from "@/components/ui/input";
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
    <main className="flex min-h-svh flex-col" data-testid="semantic-search-page">
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <span className="text-[13px] font-semibold tracking-tight">Search</span>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        <section>
          <h1 className="app-page-title">Semantic finance search</h1>
          <p className="app-page-description mt-1.5">
            Local pgvector search over synced transactions, linked evidence, and user context.
          </p>
        </section>

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
          {query.length === 0 ? <p className="px-1 text-sm text-muted-foreground">Enter a query to search the local transaction index.</p> : null}
          {query.length > 0 && results.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">No local semantic results found.</p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
