import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <main aria-label="Loading search" className="flex min-h-svh flex-col" role="status">
      <span className="sr-only">Loading search</span>
      <header className="flex items-center h-14 shrink-0 border-b border-border px-6">
        <Skeleton className="h-4 w-20" />
      </header>
      <div className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col gap-5 p-6">
        <div className="grid gap-2">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-11 w-full" />
        <div className="grid gap-2">
          {Array.from({ length: 8 }, (_, index) => <Skeleton className="h-14 w-full" key={index} />)}
        </div>
      </div>
    </main>
  );
}
