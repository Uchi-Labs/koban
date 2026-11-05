"use client";

import { ExternalLink, Landmark, LineChart, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import { ProviderConsentLine } from "@/components/provider-consent-line";
import { ProviderStatusBadge } from "@/components/provider-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/format";
import { playError, playSuccess } from "@/lib/ui-sound";
import type {
  SnapTradeConnectionSummary,
  SnapTradeSetupStatus
} from "@/lib/snaptrade-server";

interface SnapTradeStatusApiResponse {
  client_id_configured: boolean;
  configured: boolean;
  connection_count: number;
  connections: SnapTradeConnectionApi[];
  consumer_key_configured: boolean;
  error_message?: string;
  last_synced_at?: string;
  ready_for_connect: boolean;
  ready_for_sync: boolean;
  registered: boolean;
  stored_account_count: number;
  stored_position_count: number;
}

interface SnapTradeConnectionApi {
  account_count: number;
  accounts: Array<{
    currency: string;
    current_balance: number;
    id: string;
    mask?: string;
    name: string;
    type: "investment";
  }>;
  brokerage_name?: string;
  created_at?: string;
  disabled: boolean;
  error_message?: string;
  id: string;
  last_synced_at?: string;
  name: string;
  status: SnapTradeConnectionSummary["status"];
  type?: string;
}

interface SnapTradeConnectState {
  busy: boolean;
  error: string;
  message: string;
  status: SnapTradeSetupStatus;
  syncSummary: string;
}

type SnapTradeConnectAction = {
  patch: Partial<SnapTradeConnectState>;
  type: "patch";
};

function snapTradeConnectReducer(
  state: SnapTradeConnectState,
  action: SnapTradeConnectAction
): SnapTradeConnectState {
  return { ...state, ...action.patch };
}

export function SnapTradeConnectSetup({
  detailsOnly = false,
  initialStatus,
  launchRequest = 0
}: {
  detailsOnly?: boolean;
  initialStatus: SnapTradeSetupStatus;
  launchRequest?: number;
}) {
  const [state, dispatch] = useReducer(snapTradeConnectReducer, initialStatus, (status): SnapTradeConnectState => ({
    busy: false,
    error: "",
    message: "",
    status,
    syncSummary: ""
  }));
  const { busy, error, message, status, syncSummary } = state;
  const hasConnections = status.connections.length > 0;
  const handledLaunchRequest = useRef(launchRequest);

  function updateState(patch: Partial<SnapTradeConnectState>) {
    dispatch({ type: "patch", patch });
  }

  async function refreshStatus() {
    const response = await fetch("/api/v1/snaptrade/status", { cache: "no-store" });

    if (response.ok) {
      updateState({ status: statusFromApi((await response.json()) as SnapTradeStatusApiResponse) });
    }
  }

  async function openConnectionPortal() {
    updateState({
      busy: true,
      error: "",
      message: "Preparing SnapTrade connection portal…",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/v1/snaptrade/connect", {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as {
        error?: string;
        redirect_uri?: string;
        status?: SnapTradeStatusApiResponse;
      };

      if (!response.ok || !body.redirect_uri) {
        throw new Error(body.error ?? "Unable to create SnapTrade connection portal.");
      }

      const opened = window.open(body.redirect_uri, "_blank", "noopener,noreferrer");
      updateState({
        message: opened
          ? "SnapTrade portal opened. Return here and run sync after connecting a brokerage."
          : "SnapTrade portal URL is ready, but the popup was blocked.",
        status: body.status ? statusFromApi(body.status) : status
      });
    } catch (caughtError) {
      playError();
      updateState({
        error: caughtError instanceof Error ? caughtError.message : "Unable to open SnapTrade connection portal."
      });
    } finally {
      updateState({ busy: false });
    }
  }

  const launchConnectionPortal = useEffectEvent(openConnectionPortal);

  useEffect(() => {
    if (launchRequest <= handledLaunchRequest.current) {
      return;
    }

    handledLaunchRequest.current = launchRequest;
    void launchConnectionPortal();
  }, [launchRequest]);

  async function syncSnapTrade() {
    updateState({
      busy: true,
      error: "",
      message: "Syncing SnapTrade accounts and positions…",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/v1/snaptrade/sync", {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as {
        account_count?: number;
        connection_count?: number;
        error?: string;
        errors?: string[];
        position_count?: number;
        status?: SnapTradeStatusApiResponse;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "SnapTrade sync failed.");
      }

      await refreshStatus();
      playSuccess();
      updateState({
        message: "",
        status: body.status ? statusFromApi(body.status) : status,
        syncSummary: `Synced ${body.account_count ?? 0} investment accounts and ${body.position_count ?? 0} positions across ${body.connection_count ?? 0} SnapTrade connections.`
      });

      if (body.errors?.length) {
        updateState({ error: `Partial sync: ${body.errors.join(" ")}` });
      }
    } catch (caughtError) {
      playError();
      updateState({ error: caughtError instanceof Error ? caughtError.message : "SnapTrade sync failed." });
    } finally {
      updateState({ busy: false });
    }
  }

  return (
    <Card size="sm" data-testid="snaptrade-setup-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Investment accounts</h2>
          <p className="text-sm text-muted-foreground">
            Link brokerage accounts with SnapTrade to include investment balances and positions in net worth.
          </p>
        </div>
        {!detailsOnly ? (
          <div className="flex max-w-sm flex-col items-end gap-2">
            <Button variant="tonal" disabled={!status.readyForConnect || busy} onClick={openConnectionPortal} type="button">
              <ExternalLink className="size-4" aria-hidden />
              {busy ? "Working…" : hasConnections ? "Connect another brokerage" : "Connect brokerage"}
            </Button>
            <ProviderConsentLine className="text-right" />
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!detailsOnly && hasConnections ? (
          <div className="flex flex-col gap-2" aria-label="SnapTrade connections">
            {status.connections.map((connection) => (
              <SnapTradeConnectionRow connection={connection} key={connection.id} />
            ))}
            <p className="px-1 text-xs text-muted-foreground">
              {status.storedAccountCount.toLocaleString()} investment accounts,{" "}
              {status.storedPositionCount.toLocaleString()} positions.
            </p>
          </div>
        ) : !detailsOnly ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <LineChart className="size-5" aria-hidden />
            </div>
            <p className="text-sm font-medium">Connect your first brokerage</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {status.readyForConnect
                ? "Open the SnapTrade portal, connect a brokerage, then sync accounts and positions."
                : "Add SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY to your ignored .env to enable SnapTrade."}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="SnapTrade setup status">
          <CredentialTile label="Client ID" ready={status.clientIdConfigured} />
          <CredentialTile label="Consumer key" ready={status.consumerKeyConfigured} />
          <CredentialTile label="Local user" ready={status.registered} optional />
          <ValueTile label="Connections" value={status.connectionCount.toLocaleString()} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!status.readyForSync || busy}
            onClick={syncSnapTrade}
            type="button"
          >
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {busy ? "Syncing…" : "Sync SnapTrade"}
          </Button>
        </div>

        <Separator />

        {!status.readyForConnect ? (
          <p className="text-sm text-destructive">
            Add `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY` to ignored `.env` first.
          </p>
        ) : null}
        {status.errorMessage ? <p className="text-sm text-destructive">{status.errorMessage}</p> : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {syncSummary ? <p className="text-sm text-muted-foreground">{syncSummary}</p> : null}
        {status.lastSyncedAt ? (
          <p className="text-sm text-muted-foreground">
            Last SnapTrade sync: {new Date(status.lastSyncedAt).toLocaleString()}.
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function SnapTradeConnectionRow({ connection }: { connection: SnapTradeConnectionSummary }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Landmark className="size-4" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{connection.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {connection.brokerageName ?? "Brokerage"}
            {connection.type ? `, ${connection.type}` : ""}
            {connection.lastSyncedAt ? `, synced ${new Date(connection.lastSyncedAt).toLocaleString()}` : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ProviderStatusBadge status={connection.status} />
          <Badge variant="outline" className="font-normal tabular-nums">
            {connection.accountCount.toLocaleString()} accounts
          </Badge>
        </div>
      </div>
      {connection.accounts.length > 0 ? (
        <div className="flex flex-col gap-px border-t border-border pt-2">
          {connection.accounts.map((account) => (
            <div className="flex items-center gap-3 rounded-lg px-2 py-1.5" key={account.id}>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <LineChart className="size-3.5" aria-hidden />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{account.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  Investment{account.mask ? `, ****${account.mask}` : ""}
                </span>
              </div>
              <span className="ml-auto text-sm font-medium tabular-nums">
                {formatCurrency(account.currentBalance, account.currency)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {connection.errorMessage ? <p className="text-xs text-destructive">{connection.errorMessage}</p> : null}
    </article>
  );
}

function CredentialTile({ label, ready, optional = false }: { label: string; ready: boolean; optional?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={ready ? "text-sm font-medium" : optional ? "text-sm font-medium text-muted-foreground" : "text-sm font-medium text-destructive"}>
        {ready ? "Ready" : optional ? "Created on connect" : "Missing"}
      </span>
    </div>
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

function statusFromApi(body: SnapTradeStatusApiResponse): SnapTradeSetupStatus {
  return {
    clientIdConfigured: body.client_id_configured,
    configured: body.configured,
    connectionCount: body.connection_count,
    connections: body.connections.map((connection) => ({
      accountCount: connection.account_count,
      accounts: connection.accounts.map((account) => ({
        currency: account.currency,
        currentBalance: account.current_balance,
        id: account.id,
        mask: account.mask,
        name: account.name,
        type: account.type
      })),
      brokerageName: connection.brokerage_name,
      createdAt: connection.created_at,
      disabled: connection.disabled,
      errorMessage: connection.error_message,
      id: connection.id,
      lastSyncedAt: connection.last_synced_at,
      name: connection.name,
      status: connection.status,
      type: connection.type
    })),
    consumerKeyConfigured: body.consumer_key_configured,
    errorMessage: body.error_message,
    lastSyncedAt: body.last_synced_at,
    readyForConnect: body.ready_for_connect,
    readyForSync: body.ready_for_sync,
    registered: body.registered,
    storedAccountCount: body.stored_account_count,
    storedPositionCount: body.stored_position_count
  };
}
