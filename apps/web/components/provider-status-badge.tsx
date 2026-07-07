import type { ProviderStatus } from "@ai-finances/schema";
import { AnimatedBadge, type AnimatedBadgeStatus } from "@/components/ui/animated-badge";

const labels: Record<ProviderStatus, string> = {
  connected: "Connected",
  error: "Error",
  not_configured: "Not configured",
  stale: "Stale",
  syncing: "Syncing"
};

const badgeStatus: Record<ProviderStatus, AnimatedBadgeStatus> = {
  connected: "success",
  error: "danger",
  not_configured: "neutral",
  stale: "warning",
  syncing: "loading"
};

export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  return (
    <AnimatedBadge
      contentKey={status}
      pulse={status === "syncing"}
      size="sm"
      status={badgeStatus[status]}
    >
      {labels[status]}
    </AnimatedBadge>
  );
}
