import { Skeleton } from "@/components/ui/skeleton";

export default function GoalsLoading() {
  return (
    <main aria-label="Loading goals" className="flex min-h-svh flex-col" role="status">
      <span className="sr-only">Loading goals</span>
      <header className="flex items-center border-b border-border px-6 py-3.5">
        <Skeleton className="h-4 w-16" />
      </header>
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
        <div className="grid gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-[32rem] max-w-full" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="grid gap-3 rounded-2xl border border-border bg-card p-5" key={index}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
