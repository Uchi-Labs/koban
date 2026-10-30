import { Skeleton } from "@/components/ui/skeleton";

export default function CategoriesLoading() {
  return (
    <main aria-label="Loading categories" className="flex min-h-svh flex-col" role="status">
      <span className="sr-only">Loading categories</span>
      <header className="flex items-center justify-between h-14 shrink-0 border-b border-border px-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-32" />
      </header>
      <div className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col gap-5 p-6">
        <div className="grid gap-5 rounded-2xl border border-border bg-card p-5 md:grid-cols-[12rem_minmax(0,1fr)] md:items-center">
          <Skeleton className="size-44 rounded-full" />
          <div className="grid gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-5">
          {Array.from({ length: 7 }, (_, index) => <Skeleton className="h-10 w-full" key={index} />)}
        </div>
      </div>
    </main>
  );
}
