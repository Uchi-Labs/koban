import { Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { FinanceKitSetupStatus } from "@/lib/financekit-server";

export function FinanceKitConnectSetup({
  endpointUrl,
  initialStatus
}: {
  endpointUrl: string;
  initialStatus: FinanceKitSetupStatus;
}) {
  return (
    <Card size="sm" data-testid="financekit-setup-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">FinanceKit companion</h2>
          <p className="text-sm text-muted-foreground">
            Receive Apple Card, Apple Cash, and Apple Savings data from the iOS companion app.
          </p>
        </div>
        <Badge variant={initialStatus.lastIngestedAt ? "default" : "outline"} className="font-normal">
          {initialStatus.lastIngestedAt ? "Receiving data" : "Not synced"}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="FinanceKit setup status">
          <ValueTile label="Connections" value={initialStatus.providerConnectionCount.toLocaleString()} />
          <ValueTile label="Accounts" value={initialStatus.storedAccountCount.toLocaleString()} />
          <ValueTile label="Transactions" value={initialStatus.storedTransactionCount.toLocaleString()} />
          <ValueTile
            label="Last ingest"
            value={initialStatus.lastIngestedAt ? new Date(initialStatus.lastIngestedAt).toLocaleDateString() : "Never"}
          />
        </div>

        <Separator />

        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Smartphone className="size-4" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">
            <p>
              Install the iOS companion on the iPhone that has Apple Card, Apple Cash, or Apple Savings provisioned.
            </p>
            <p>
              Enter endpoint <code className="rounded bg-muted px-1 py-0.5 text-xs">{endpointUrl}</code> and bearer token{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">AI_FINANCES_AUTH_TOKEN</code> in the companion app.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ValueTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
