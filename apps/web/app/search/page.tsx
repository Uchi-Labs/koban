import { SearchView } from "@/components/search-view";
import { semanticSearchFinanceResources } from "@/lib/db/finance-db";
import { getFinanceData } from "@/lib/finance-data";

export default async function SearchPage({
  searchParams
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = typeof params?.q === "string" ? params.q.trim() : "";
  const { categories } = await getFinanceData();
  const results = query.length > 0 ? await semanticSearchFinanceResources(query, 20) : [];

  return <SearchView categories={categories} query={query} results={results} />;
}
