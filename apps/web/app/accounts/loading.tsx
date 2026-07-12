import { Skeleton } from "@/components/ui/skeleton";

export default function AccountsLoading() {
  return (
    <main aria-label="Loading accounts" className="flex min-h-svh flex-col" role="status">
      <span className="sr-only">Loading accounts</span>
      <header className="flex items-center justify-between border-b border-border px-6 py-3.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-36" />
      </header>
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
        <div className="grid gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-24 w-full" key={index} />)}
        </div>
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: 7 }, (_, index) => <Skeleton className="h-10 w-full" key={index} />)}
        </div>
      </div>
    </main>
  );
}
