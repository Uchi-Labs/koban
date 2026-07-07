import Link from "next/link";
import { cn } from "@/lib/utils";

export function ProviderConsentLine({ className }: { className?: string }) {
  return (
    <p className={cn("max-w-sm text-xs leading-5 text-muted-foreground", className)}>
      By connecting, you authorize read-only access to this institution&apos;s data and agree to the{" "}
      <Link className="text-foreground underline-offset-4 hover:underline" href="/privacy">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
