import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main aria-label="Loading page" className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-6 lg:px-8" role="status">
      <span className="sr-only">Loading page</span>
      <Skeleton className="mb-5 h-6 w-36" />
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div className="grid gap-4 rounded-2xl border border-border bg-card p-5" key={index}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        ))}
      </div>
    </main>
  );
}
