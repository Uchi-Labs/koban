import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="min-h-svh bg-background px-4 py-12 sm:px-6">
      <section className="mx-auto max-w-xl rounded-2xl bg-card p-6 shadow-(--elevation-card) sm:p-8">
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance text-foreground">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-pretty text-muted-foreground">
          This address doesn&apos;t match a page in Koban. The link may be old, or the account it pointed to may no longer
          be synced.
        </p>
        <Link className={cn(buttonVariants({ variant: "outline" }), "mt-6")} href="/">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
