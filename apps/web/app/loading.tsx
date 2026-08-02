import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <main
      aria-label="Loading dashboard"
      className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-6 lg:px-8"
      role="status"
    >
      <span className="sr-only">Loading dashboard</span>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-6 w-32 rounded-full" />
      </div>
      <section className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="grid gap-3 rounded-2xl border border-border bg-card p-5" key={index}>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-3 w-52 max-w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ))}
      </section>
    </main>
  );
}
