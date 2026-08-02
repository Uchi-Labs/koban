import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <main
      aria-label="Loading settings"
      className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 sm:p-6"
      role="status"
    >
      <span className="sr-only">Loading settings</span>
      <div className="grid gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-5" key={index}>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
          <div className="grid gap-2">
            {Array.from({ length: 3 }, (_, row) => <Skeleton className="h-10 w-full" key={row} />)}
          </div>
        </div>
      ))}
    </main>
  );
}
