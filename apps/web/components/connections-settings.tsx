"use client";

import type { ProviderConnection, ProviderStatus } from "@ai-finances/schema";
import {
  ArrowUpRight,
  ExternalLink,
  Landmark,
  LineChart,
  Loader2,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  WalletCards
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FinanceKitConnectSetup } from "@/components/financekit-connect-setup";
import { BouncyAccordion } from "@/components/motion/bouncy-accordion";
import { PlaidConnectSetup } from "@/components/plaid-connect-setup";
import { SimpleFinConnectSetup } from "@/components/simplefin-connect-setup";
import { SnapTradeConnectSetup } from "@/components/snaptrade-connect-setup";
import { TellerConnectSetup } from "@/components/teller-connect-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { playError, playSuccess } from "@/lib/ui-sound";
import type { FinanceKitSetupStatus } from "@/lib/financekit-server";
import type { PlaidSetupStatus } from "@/lib/plaid-server";
import type { SimpleFinSetupStatus } from "@/lib/simplefin-server";
import type { SnapTradeSetupStatus } from "@/lib/snaptrade-server";
import type { TellerSetupStatus } from "@/lib/teller-server";
import { cn } from "@/lib/utils";

type ConnectionProvider = "financekit" | "plaid" | "simplefin" | "snaptrade" | "teller";

interface UnifiedConnectionRow {
  accountCount: number;
  errorMessage?: string;
  id: string;
  lastSyncedAt?: string;
  name: string;
  provider: ConnectionProvider;
  removable: boolean;
  status: ProviderStatus;
  syncable: boolean;
}

interface LaunchRequests {
  plaid: number;
  snaptrade: number;
  teller: number;
}

const providerLabels: Record<ConnectionProvider, string> = {
  financekit: "FinanceKit",
  plaid: "Plaid",
  simplefin: "SimpleFIN",
  snaptrade: "SnapTrade",
  teller: "Teller"
};

const providerIcons = {
  financekit: Smartphone,
  plaid: WalletCards,
  simplefin: WalletCards,
  snaptrade: LineChart,
  teller: Landmark
} satisfies Record<ConnectionProvider, typeof Landmark>;

const syncEndpoints: Partial<Record<ConnectionProvider, string>> = {
  plaid: "/api/v1/plaid/sync",
  simplefin: "/api/v1/simplefin/sync",
  snaptrade: "/api/v1/snaptrade/sync",
  teller: "/api/teller/sync"
};

export function ConnectionsSettings({
  accountCountByConnection,
  financeKitStatus,
  plaidStatus,
  providerConnections,
  simpleFinStatus,
  snapTradeStatus,
  tellerStatus
}: {
  accountCountByConnection: Record<string, number>;
  financeKitStatus: FinanceKitSetupStatus;
  plaidStatus: PlaidSetupStatus;
  providerConnections: ProviderConnection[];
  simpleFinStatus: SimpleFinSetupStatus;
  snapTradeStatus: SnapTradeSetupStatus;
  tellerStatus: TellerSetupStatus;
}) {
  const router = useRouter();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [detailsValue, setDetailsValue] = useState<string | null>(null);
  const [launchRequests, setLaunchRequests] = useState<LaunchRequests>({ plaid: 0, snaptrade: 0, teller: 0 });
  const [pendingRemoval, setPendingRemoval] = useState<UnifiedConnectionRow | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string } | null>(null);
  const rows = useMemo(
    () =>
      buildConnectionRows({
        accountCountByConnection,
        financeKitStatus,
        plaidStatus,
        providerConnections,
        simpleFinStatus,
        snapTradeStatus,
        tellerStatus
      }),
    [
      accountCountByConnection,
      financeKitStatus,
      plaidStatus,
      providerConnections,
      simpleFinStatus,
      snapTradeStatus,
      tellerStatus
    ]
  );

  function launchProvider(provider: "financekit" | "plaid" | "snaptrade" | "teller") {
    setAddDialogOpen(false);
    setDetailsValue(provider);

    if (provider === "financekit") {
      return;
    }

    setLaunchRequests((current) => ({ ...current, [provider]: current[provider] + 1 }));
  }

  async function syncProvider(row: UnifiedConnectionRow) {
    const endpoint = syncEndpoints[row.provider];

    if (!endpoint || busyAction) {
      return;
    }

    setBusyAction(`sync:${row.provider}`);
    setFeedback(null);

    try {
      const response = await fetch(endpoint, {
        ...(row.provider === "teller"
          ? {}
          : {
              body: JSON.stringify({}),
              headers: { "Content-Type": "application/json" }
            }),
        method: "POST"
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? `${providerLabels[row.provider]} sync failed.`);
      }

      playSuccess();
      setFeedback({ text: `${providerLabels[row.provider]} sync completed.` });
      router.refresh();
    } catch (error) {
      playError();
      setFeedback({
        error: true,
        text: error instanceof Error ? error.message : `${providerLabels[row.provider]} sync failed.`
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeTellerConnection() {
    if (!pendingRemoval || pendingRemoval.provider !== "teller" || busyAction) {
      return;
    }

    const row = pendingRemoval;
    setBusyAction(`remove:${row.id}`);
    setFeedback(null);

    try {
      const response = await fetch(`/api/teller/connections/${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to remove the Teller connection.");
      }

      playSuccess();
      setPendingRemoval(null);
      setFeedback({ text: `${row.name} was removed from this app.` });
      router.refresh();
    } catch (error) {
      playError();
      setFeedback({
        error: true,
        text: error instanceof Error ? error.message : "Unable to remove the Teller connection."
      });
    } finally {
      setBusyAction(null);
    }
  }

  const detailItems = [
    {
      description: (
        <TellerConnectSetup
          detailsOnly
          initialStatus={tellerStatus}
          launchRequest={launchRequests.teller}
          panelTestId="teller-provider-details"
        />
      ),
      icon: <Landmark className="size-4" aria-hidden />,
      id: "teller",
      title: <ProviderDetailTitle count={tellerStatus.enrollmentCount} label="Teller" />
    },
    {
      description: (
        <PlaidConnectSetup
          detailsOnly
          initialStatus={plaidStatus}
          launchRequest={launchRequests.plaid}
        />
      ),
      icon: <WalletCards className="size-4" aria-hidden />,
      id: "plaid",
      title: <ProviderDetailTitle count={plaidStatus.itemCount} label="Plaid" />
    },
    {
      description: (
        <SnapTradeConnectSetup
          detailsOnly
          initialStatus={snapTradeStatus}
          launchRequest={launchRequests.snaptrade}
        />
      ),
      icon: <LineChart className="size-4" aria-hidden />,
      id: "snaptrade",
      title: <ProviderDetailTitle count={snapTradeStatus.connectionCount} label="SnapTrade" />
    },
    {
      description: <FinanceKitConnectSetup endpointUrl="/api/v1/financekit/ingest" initialStatus={financeKitStatus} />,
      icon: <Smartphone className="size-4" aria-hidden />,
      id: "financekit",
      title: <ProviderDetailTitle count={financeKitStatus.providerConnectionCount} label="FinanceKit" />
    },
    ...(simpleFinStatus.configured
      ? [
          {
            description: <SimpleFinConnectSetup detailsOnly initialStatus={simpleFinStatus} />,
            icon: <WalletCards className="size-4" aria-hidden />,
            id: "simplefin",
            title: <ProviderDetailTitle count={simpleFinStatus.connectionCount} label="SimpleFIN" />
          }
        ]
      : [])
  ];

  return (
    <section className="flex flex-col gap-4" data-testid="teller-setup-panel">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border pb-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Bank accounts</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every bank and brokerage connection in one place. Sync or remove a connection without hunting through provider cards.
            </p>
          </div>
          <Button
            aria-label="Connect bank account"
            className="shrink-0"
            onClick={() => setAddDialogOpen(true)}
            type="button"
            variant="tonal"
          >
            <Plus className="size-4" aria-hidden />
            Add connection
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div
            aria-hidden
            className="hidden grid-cols-[minmax(220px,1.6fr)_110px_130px_90px_170px_minmax(92px,auto)] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:grid"
          >
            <span>Institution</span>
            <span>Type</span>
            <span>Status</span>
            <span>Accounts</span>
            <span>Last synced</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-border" aria-label="Provider connections">
            {rows.map((row) => (
              <ConnectionRow
                busyAction={busyAction}
                key={`${row.provider}:${row.id}`}
                onRemove={() => setPendingRemoval(row)}
                onSync={() => void syncProvider(row)}
                row={row}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {feedback ? (
        <p className={cn("px-1 text-sm", feedback.error ? "text-destructive" : "text-muted-foreground")} role="status">
          {feedback.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-medium">Provider setup & diagnostics</h2>
          <p className="text-xs text-muted-foreground">Credentials, health checks, and companion setup stay tucked away until needed.</p>
        </div>
        <BouncyAccordion
          classNames={{
            description: "text-foreground",
            item: "border border-border bg-muted/20",
            trigger: "min-h-12 px-4",
            content: "bg-background/40"
          }}
          items={detailItems}
          onValueChange={setDetailsValue}
          value={detailsValue}
        />
      </div>

      <AddConnectionDialog
        financeKitStatus={financeKitStatus}
        onLaunch={launchProvider}
        onOpenChange={setAddDialogOpen}
        open={addDialogOpen}
        plaidStatus={plaidStatus}
        snapTradeStatus={snapTradeStatus}
        tellerStatus={tellerStatus}
      />
      <RemoveConnectionDialog
        busy={busyAction === `remove:${pendingRemoval?.id ?? ""}`}
        onConfirm={() => void removeTellerConnection()}
        onOpenChange={(open) => {
          if (!open && !busyAction) {
            setPendingRemoval(null);
          }
        }}
        row={pendingRemoval}
      />
    </section>
  );
}

function ConnectionRow({
  busyAction,
  onRemove,
  onSync,
  row
}: {
  busyAction: string | null;
  onRemove: () => void;
  onSync: () => void;
  row: UnifiedConnectionRow;
}) {
  const Icon = providerIcons[row.provider];
  const syncing = busyAction === `sync:${row.provider}`;

  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/20 motion-reduce:transition-none md:grid-cols-[minmax(220px,1.6fr)_110px_130px_90px_170px_minmax(92px,auto)]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{row.name}</span>
          {row.errorMessage ? <span className="block truncate text-xs text-destructive">{row.errorMessage}</span> : null}
        </span>
      </div>
      <div className="justify-self-end md:col-start-6 md:row-start-1">
        <RowActions
          busy={Boolean(busyAction)}
          onRemove={onRemove}
          onSync={onSync}
          removable={row.removable}
          syncable={row.syncable}
          syncing={syncing}
        />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-12 md:contents">
        <Badge className="font-normal" variant="outline">{providerLabels[row.provider]}</Badge>
        <ConnectionStatusBadge status={row.status} />
        <span className="text-xs text-muted-foreground md:text-sm md:text-foreground tabular-nums">
          <span className="md:hidden">Accounts </span>{row.accountCount.toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{formatLastSynced(row.lastSyncedAt)}</span>
      </div>
    </article>
  );
}

function RowActions({
  busy,
  onRemove,
  onSync,
  removable,
  syncable,
  syncing
}: {
  busy: boolean;
  onRemove: () => void;
  onSync: () => void;
  removable: boolean;
  syncable: boolean;
  syncing: boolean;
}) {
  if (!removable && !syncable) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex justify-end gap-1">
      {syncable ? (
        <Button aria-label="Sync connection" disabled={busy} onClick={onSync} size="icon-sm" type="button" variant="ghost">
          {syncing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
        </Button>
      ) : null}
      {removable ? (
        <Button
          aria-label="Remove connection"
          className="text-muted-foreground hover:text-destructive"
          disabled={busy}
          onClick={onRemove}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function ConnectionStatusBadge({ status }: { status: ProviderStatus }) {
  const labels: Record<ProviderStatus, string> = {
    connected: "Connected",
    error: "Error",
    not_configured: "Not set up",
    stale: "Needs sync",
    syncing: "Syncing"
  };

  return (
    <Badge
      className={cn(
        "gap-1.5 font-normal",
        status === "error" && "border-destructive/30 text-destructive",
        status === "connected" && "border-(--positive)/25 text-(--positive)"
      )}
      variant="outline"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-muted-foreground",
          status === "connected" && "bg-(--positive)",
          status === "error" && "bg-destructive",
          status === "syncing" && "animate-pulse motion-reduce:animate-none"
        )}
      />
      {labels[status]}
    </Badge>
  );
}

function ProviderDetailTitle({ count, label }: { count: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <span className="text-xs font-normal text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
    </span>
  );
}

function AddConnectionDialog({
  financeKitStatus,
  onLaunch,
  onOpenChange,
  open,
  plaidStatus,
  snapTradeStatus,
  tellerStatus
}: {
  financeKitStatus: FinanceKitSetupStatus;
  onLaunch: (provider: "financekit" | "plaid" | "snaptrade" | "teller") => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  plaidStatus: PlaidSetupStatus;
  snapTradeStatus: SnapTradeSetupStatus;
  tellerStatus: TellerSetupStatus;
}) {
  const options = [
    // Teller withdrew its API product (Jul 2026); only offer it while enrollments
    // still exist (so they can be managed), never for new connections.
    ...(tellerStatus.enrollmentCount > 0
      ? [
          {
            description: "Legacy Teller enrollments (provider discontinued)",
            enabled: tellerStatus.readyForConnect,
            icon: Landmark,
            id: "teller" as const,
            label: "Teller Connect"
          }
        ]
      : []),
    {
      description: plaidStatus.readyForLink ? "Bank transaction accounts" : "Plaid credentials missing",
      enabled: plaidStatus.readyForLink,
      icon: WalletCards,
      id: "plaid" as const,
      label: "Plaid Link"
    },
    {
      description: snapTradeStatus.readyForConnect ? "Brokerage and investment accounts" : "SnapTrade credentials missing",
      enabled: snapTradeStatus.readyForConnect,
      icon: LineChart,
      id: "snaptrade" as const,
      label: "SnapTrade portal"
    },
    {
      description: financeKitStatus.lastIngestedAt ? "Review companion instructions" : "Set up the iOS companion",
      enabled: true,
      icon: Smartphone,
      id: "financekit" as const,
      label: "FinanceKit companion"
    }
  ];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription>Choose how you want to bring financial accounts into Koban.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const Icon = option.icon;

            return (
              <button
                className="group flex min-h-24 items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
                disabled={!option.enabled}
                key={option.id}
                onClick={() => onLaunch(option.id)}
                type="button"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {option.label}
                    {option.id === "snaptrade" ? <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" aria-hidden />
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RemoveConnectionDialog({
  busy,
  onConfirm,
  onOpenChange,
  row
}: {
  busy: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  row: UnifiedConnectionRow | null;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={row !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {row?.name ?? "this connection"}?</DialogTitle>
          <DialogDescription>
            This removes the Teller enrollment and its {row?.accountCount.toLocaleString() ?? 0} local accounts. Your bank account is not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={busy} onClick={() => onOpenChange(false)} type="button" variant="ghost">Cancel</Button>
          <Button disabled={busy} onClick={onConfirm} type="button" variant="destructive">
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {busy ? "Removing…" : "Remove connection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildConnectionRows({
  accountCountByConnection,
  financeKitStatus,
  plaidStatus,
  providerConnections,
  simpleFinStatus,
  snapTradeStatus,
  tellerStatus
}: {
  accountCountByConnection: Record<string, number>;
  financeKitStatus: FinanceKitSetupStatus;
  plaidStatus: PlaidSetupStatus;
  providerConnections: ProviderConnection[];
  simpleFinStatus: SimpleFinSetupStatus;
  snapTradeStatus: SnapTradeSetupStatus;
  tellerStatus: TellerSetupStatus;
}): UnifiedConnectionRow[] {
  const rows: UnifiedConnectionRow[] = [];
  const storedConnectionById = new Map(providerConnections.map((connection) => [connection.id, connection]));

  rows.push(
    ...tellerStatus.connections.map((connection) => {
      const storedConnection = storedConnectionById.get(`provider_teller_${connection.id}`);

      return {
        accountCount: connection.accountCount,
        errorMessage: storedConnection?.errorMessage,
        id: connection.id,
        lastSyncedAt: storedConnection?.lastSyncedAt ?? tellerStatus.lastLedgerSyncedAt,
        name: connection.institutionName ?? `Teller connection …${connection.enrollmentIdSuffix}`,
        provider: "teller" as const,
        removable: true,
        status: storedConnection?.status ?? ("connected" as const),
        syncable: tellerStatus.readyForApi
      };
    })
  );
  // No empty-state row for Teller: the provider shut down, so a "not set up"
  // prompt would invite connecting to a dead service.

  rows.push(
    ...plaidStatus.items.map((item) => ({
      accountCount: item.accountCount,
      errorMessage: item.errorMessage,
      id: item.id,
      lastSyncedAt: item.lastSyncedAt,
      name: item.institutionName,
      provider: "plaid" as const,
      removable: false,
      status: item.status,
      syncable: plaidStatus.readyForSync
    }))
  );
  if (plaidStatus.items.length === 0) {
    rows.push(emptyProviderRow("plaid", "No Plaid connection"));
  }

  rows.push(
    ...snapTradeStatus.connections.map((connection) => ({
      accountCount: connection.accountCount,
      errorMessage: connection.errorMessage,
      id: connection.id,
      lastSyncedAt: connection.lastSyncedAt,
      // SnapTrade names authorizations "Connection-N"; the brokerage is the identity.
      name: connection.brokerageName ?? connection.name,
      provider: "snaptrade" as const,
      removable: false,
      status: connection.status,
      syncable: snapTradeStatus.readyForSync
    }))
  );
  if (snapTradeStatus.connections.length === 0) {
    rows.push(emptyProviderRow("snaptrade", "No SnapTrade connection"));
  }

  const financeKitConnections = providerConnections.filter((connection) => connection.provider === "financekit");
  rows.push(
    ...financeKitConnections.map((connection) => ({
      accountCount: accountCountByConnection[connection.id] ?? 0,
      errorMessage: connection.errorMessage,
      id: connection.id,
      lastSyncedAt: connection.lastSyncedAt ?? financeKitStatus.lastIngestedAt,
      name: cleanProviderName(connection.displayName, "FinanceKit"),
      provider: "financekit" as const,
      removable: false,
      status: connection.status,
      syncable: false
    }))
  );
  if (financeKitConnections.length === 0) {
    rows.push(emptyProviderRow("financekit", "No FinanceKit connection"));
  }

  if (simpleFinStatus.configured) {
    rows.push(
      ...simpleFinStatus.connections.map((connection) => ({
        accountCount: connection.accountCount,
        errorMessage: connection.errorMessage,
        id: connection.id,
        lastSyncedAt: connection.lastSyncedAt,
        name: connection.name,
        provider: "simplefin" as const,
        removable: false,
        status: connection.status,
        syncable: simpleFinStatus.readyForSync
      }))
    );
    if (simpleFinStatus.connections.length === 0) {
      rows.push(emptyProviderRow("simplefin", "No SimpleFIN connection"));
    }
  }

  return rows;
}

function emptyProviderRow(provider: ConnectionProvider, name: string): UnifiedConnectionRow {
  return {
    accountCount: 0,
    id: `empty-${provider}`,
    name,
    provider,
    removable: false,
    status: "not_configured",
    syncable: false
  };
}

function cleanProviderName(displayName: string, provider: string) {
  return displayName.replace(new RegExp(`^${provider}\\s*-\\s*`, "i"), "") || displayName;
}

function formatLastSynced(value?: string) {
  if (!value) {
    return "Not synced";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  }).format(new Date(value));
}
