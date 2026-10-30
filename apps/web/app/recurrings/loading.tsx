import { Skeleton } from "@/components/ui/skeleton";

export default function RecurringsLoading() {
  return (
    <main aria-label="Loading recurrings" className="flex min-h-svh flex-col" role="status">
      <span className="sr-only">Loading recurrings</span>
      <header className="flex items-center h-14 shrink-0 border-b border-border px-6">
        <Skeleton className="h-4 w-24" />
      </header>
      <div className="mx-auto grid w-full max-w-[70rem] flex-1 items-start gap-6 p-6 xl:max-w-[78rem] xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] 2xl:max-w-[96rem]">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 xl:mx-0 xl:max-w-none">
          <div className="grid justify-items-center gap-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid gap-3 rounded-2xl border border-border bg-card p-5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-56 w-full" />
          </div>
        </div>
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-32" />
          {Array.from({ length: 8 }, (_, index) => (
            <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 py-1" key={index}>
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
