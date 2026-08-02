import { Skeleton } from "@/components/ui/skeleton";

export default function AccountDetailLoading() {
  return (
    <main aria-label="Loading account" className="flex min-h-svh flex-col" role="status">
      <span className="sr-only">Loading account</span>
      <header className="flex items-center justify-between border-b border-border px-6 py-3.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-28" />
      </header>
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-36" />
          {Array.from({ length: 10 }, (_, index) => (
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_5.5rem] items-center gap-3 py-1" key={index}>
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
