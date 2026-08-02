import { Skeleton } from "@/components/ui/skeleton";

export default function CashFlowLoading() {
  return (
    <main
      aria-label="Loading cash flow"
      className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 lg:px-8"
      role="status"
    >
      <span className="sr-only">Loading cash flow</span>
      <div className="mb-5 grid gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-8 w-24 rounded-full" key={index} />)}
      </div>
      <div className="grid gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-end justify-between gap-4">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
      <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-card p-5">
        <Skeleton className="h-5 w-36" />
        {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-9 w-full" key={index} />)}
      </div>
    </main>
  );
}
