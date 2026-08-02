import { Skeleton } from "@/components/ui/skeleton";

export default function InvestmentsLoading() {
  return (
    <main
      aria-label="Loading investments"
      className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 lg:px-8"
      role="status"
    >
      <span className="sr-only">Loading investments</span>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-8 w-52" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-24 w-full" key={index} />)}
      </div>
      <div className="mt-5 grid gap-3 rounded-2xl border border-border bg-card p-5">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 8 }, (_, index) => (
          <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-3 py-1" key={index}>
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </main>
  );
}
