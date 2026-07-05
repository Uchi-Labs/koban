import type { ProviderStatus } from "@ai-finances/schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const labels: Record<ProviderStatus, string> = {
  connected: "Connected",
  error: "Error",
  not_configured: "Not configured",
  stale: "Stale",
  syncing: "Syncing"
};

// No shadcn "success" token exists, so connection health is carried by a small
// status dot. Structural styling stays on semantic tokens (Badge outline).
const dotClass: Record<ProviderStatus, string> = {
  connected: "bg-emerald-500",
  error: "bg-destructive",
  not_configured: "bg-muted-foreground/50",
  stale: "bg-amber-500",
  syncing: "bg-sky-500 animate-pulse"
};

export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dotClass[status])} aria-hidden />
      {labels[status]}
    </Badge>
  );
}
