import { Skeleton } from "@/components/ui/skeleton";

export default function InsightsLoading() {
  return (
    <main
      aria-label="Loading insights"
      className="mx-auto flex h-[calc(100svh-5.5rem-env(safe-area-inset-bottom))] w-full max-w-3xl flex-col px-4 py-5 md:h-svh md:px-6 xl:max-w-5xl"
      role="status"
    >
      <span className="sr-only">Loading insights</span>
      <header className="mb-5 shrink-0 grid gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </header>
      <div className="mb-5 min-w-0 shrink-0 grid gap-3 rounded-2xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-28 w-full" />
      </div>
      <div className="grid content-start gap-5">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="grid gap-2 rounded-2xl border border-border bg-card p-5" key={index}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-64 max-w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </main>
  );
}
