import { Skeleton } from "@/components/ui/skeleton";

export default function RulesLoading() {
  return (
    <main aria-label="Loading rules" className="flex min-h-svh flex-col" role="status">
      <span className="sr-only">Loading rules</span>
      <header className="flex items-center h-14 shrink-0 border-b border-border px-6">
        <Skeleton className="h-4 w-14" />
      </header>
      <div className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col gap-5 p-6">
        <div className="grid gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 6 }, (_, index) => <Skeleton className="h-11 w-full" key={index} />)}
        </div>
      </div>
    </main>
  );
}
