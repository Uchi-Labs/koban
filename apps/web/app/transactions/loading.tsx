import { Skeleton } from "@/components/ui/skeleton";

export default function TransactionsLoading() {
  return (
    <main aria-label="Loading transactions" className="flex h-[100dvh] min-h-0 flex-col bg-background" role="status">
      <span className="sr-only">Loading transactions</span>
      <header className="flex items-center justify-between gap-4 border-b border-border px-3 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-32" />
        </div>
        <Skeleton className="h-8 w-64 max-w-[45vw]" />
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        {/* Same centred measure as the real list (transactions-view.tsx:2560,
            2631). Without it the skeleton rows ran the full width of the column
            while the loaded rows snapped into a centred 70rem block, so the page
            visibly jumped sideways the moment data arrived. */}
        <div className="overflow-hidden p-4 sm:p-6">
          <div className="mx-auto grid w-full max-w-[70rem] content-start gap-2">
            {Array.from({ length: 10 }, (_, index) => (
              <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_8rem_5.5rem] items-center gap-3 py-2" key={index}>
                <Skeleton className="size-4" />
                <div className="grid gap-1.5">
                  <Skeleton className="h-3.5 w-44 max-w-full" />
                  <Skeleton className="h-3 w-28 max-w-full" />
                </div>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
        <aside className="hidden border-l border-border bg-card p-5 lg:grid lg:content-start lg:gap-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </aside>
      </div>
    </main>
  );
}
