import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewLoading() {
  return (
    <main
      aria-label="Loading review"
      className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col px-4 py-5 md:px-6"
      role="status"
    >
      <span className="sr-only">Loading review</span>
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-8 w-24" />
      </header>
      <div className="grid gap-4 rounded-2xl border border-border bg-card p-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-64 max-w-full" />
        <Skeleton className="h-4 w-44" />
        <div className="mt-2 flex flex-wrap gap-2">
          {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-8 w-24 rounded-full" key={index} />)}
        </div>
      </div>
    </main>
  );
}
