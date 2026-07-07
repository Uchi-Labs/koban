"use client";

import { CreditCard, Landmark, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { useReducer } from "react";
import { ProviderConsentLine } from "@/components/provider-consent-line";
import { ProviderStatusBadge } from "@/components/provider-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/format";
import { playError, playSuccess } from "@/lib/ui-sound";
import type {
  SimpleFinConnectionSummary,
  SimpleFinSetupStatus
} from "@/lib/simplefin-server";

interface SimpleFinStatusApiResponse {
  access_url_configured: boolean;
  configured: boolean;
  connection_count: number;
  connections: SimpleFinConnectionApi[];
  last_errors: unknown[];
  last_synced_at?: string;
  latest_balance_as_of?: string;
  ready_for_sync: boolean;
  stored_account_count: number;
  stored_transaction_count: number;
}

interface SimpleFinConnectionApi {
  account_count: number;
  accounts: Array<{
    balance_as_of?: string;
    currency: string;
    current_balance: number;
    id: string;
    name: string;
    standby: boolean;
    type: SimpleFinConnectionSummary["accounts"][number]["type"];
  }>;
  error_message?: string;
  id: string;
  last_synced_at?: string;
  name: string;
  status: SimpleFinConnectionSummary["status"];
  transaction_count: number;
}

interface SimpleFinConnectState {
  busy: boolean;
  error: string;
  message: string;
  status: SimpleFinSetupStatus;
  syncSummary: string;
}

type SimpleFinConnectAction = {
  patch: Partial<SimpleFinConnectState>;
  type: "patch";
};

function simpleFinConnectReducer(
  state: SimpleFinConnectState,
  action: SimpleFinConnectAction
): SimpleFinConnectState {
  return { ...state, ...action.patch };
}

export function SimpleFinConnectSetup({ initialStatus }: { initialStatus: SimpleFinSetupStatus }) {
  const [state, dispatch] = useReducer(simpleFinConnectReducer, initialStatus, (status): SimpleFinConnectState => ({
    busy: false,
    error: "",
    message: "",
    status,
    syncSummary: ""
  }));
  const { busy, error, message, status, syncSummary } = state;
  const hasConnections = status.connections.length > 0;

  function updateState(patch: Partial<SimpleFinConnectState>) {
    dispatch({ type: "patch", patch });
  }

  async function refreshStatus() {
    const response = await fetch("/api/v1/simplefin/status", { cache: "no-store" });

    if (response.ok) {
      updateState({ status: statusFromApi((await response.json()) as SimpleFinStatusApiResponse) });
    }
  }

  async function syncSimpleFin() {
    updateState({
      busy: true,
      error: "",
      message: "Syncing SimpleFIN accounts and transactions...",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/v1/simplefin/sync", {
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
        errors?: unknown[];
        status?: SimpleFinStatusApiResponse;
        transaction_count?: number;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "SimpleFIN sync failed.");
      }

      await refreshStatus();
      playSuccess();
      updateState({
        message: "",
        status: body.status ? statusFromApi(body.status) : status,
        syncSummary: `Synced ${body.account_count ?? 0} accounts and ${body.transaction_count ?? 0} transactions across ${body.connection_count ?? 0} institutions.`
      });

      if (body.errors?.length) {
        updateState({ error: `SimpleFIN reported ${body.errors.length} issue${body.errors.length === 1 ? "" : "s"}.` });
      }
    } catch (caughtError) {
      playError();
      updateState({ error: caughtError instanceof Error ? caughtError.message : "SimpleFIN sync failed." });
    } finally {
      updateState({ busy: false });
    }
  }

  return (
    <Card size="sm" data-testid="simplefin-setup-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">SimpleFIN Bridge</h2>
          <p className="text-sm text-muted-foreground">
            Sync Bridge-backed bank and credit-card balances with one manual request.
          </p>
        </div>
        <div className="flex max-w-sm flex-col items-end gap-2">
          <Button variant="tonal" disabled={!status.readyForSync || busy} onClick={syncSimpleFin} type="button">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {busy ? "Syncing..." : "Sync SimpleFIN"}
          </Button>
          <ProviderConsentLine className="text-right" />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {hasConnections ? (
          <div className="flex flex-col gap-2" aria-label="SimpleFIN institutions">
            {status.connections.map((connection) => (
              <SimpleFinConnectionRow connection={connection} key={connection.id} />
            ))}
            <p className="px-1 text-xs text-muted-foreground">
              {status.storedAccountCount.toLocaleString()} accounts,{" "}
              {status.storedTransactionCount.toLocaleString()} transactions.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <WalletCards className="size-5" aria-hidden />
            </div>
            <p className="text-sm font-medium">No SimpleFIN accounts synced</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {status.readyForSync
                ? "Run a manual SimpleFIN sync to import Bridge accounts and transactions."
                : "Add SIMPLEFIN_ACCESS_URL to your ignored .env to enable SimpleFIN."}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="SimpleFIN setup status">
          <CredentialTile label="Access URL" ready={status.accessUrlConfigured} />
          <ValueTile label="Institutions" value={status.connectionCount.toLocaleString()} />
          <ValueTile label="Accounts" value={status.storedAccountCount.toLocaleString()} />
          <ValueTile label="Transactions" value={status.storedTransactionCount.toLocaleString()} />
        </div>

        <Separator />

        {!status.readyForSync ? (
          <p className="text-sm text-destructive">Add `SIMPLEFIN_ACCESS_URL` to ignored `.env` first.</p>
        ) : null}
        {status.latestBalanceAsOf ? (
          <p className="text-sm text-muted-foreground">
            Latest SimpleFIN balance as of {new Date(status.latestBalanceAsOf).toLocaleString()}.
          </p>
        ) : null}
        {status.lastSyncedAt ? (
          <p className="text-sm text-muted-foreground">
            Last SimpleFIN fetch: {new Date(status.lastSyncedAt).toLocaleString()}.
          </p>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {syncSummary ? <p className="text-sm text-muted-foreground">{syncSummary}</p> : null}
        {status.lastErrors.length > 0 ? <SimpleFinErrors errors={status.lastErrors} /> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function SimpleFinConnectionRow({ connection }: { connection: SimpleFinConnectionSummary }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Landmark className="size-4" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{connection.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {connection.lastSyncedAt ? `Fetched ${new Date(connection.lastSyncedAt).toLocaleString()}` : "Not fetched yet"}
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
                {account.type === "credit_card" ? (
                  <CreditCard className="size-3.5" aria-hidden />
                ) : (
                  <WalletCards className="size-3.5" aria-hidden />
                )}
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{account.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {account.type.replaceAll("_", " ")}
                  {account.balanceAsOf ? `, as of ${new Date(account.balanceAsOf).toLocaleDateString()}` : ""}
                  {account.standby ? ", Plaid standby" : ""}
                </span>
              </div>
              {account.standby ? (
                <Badge variant="outline" className="font-normal">
                  Standby
                </Badge>
              ) : null}
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

function SimpleFinErrors({ errors }: { errors: unknown[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
      <p className="text-sm font-medium text-destructive">SimpleFIN reported issues</p>
      <ul className="flex flex-col gap-1 text-xs text-destructive">
        {errors.map((item) => {
          const message = formatSimpleFinError(item);
          return <li key={message}>{message}</li>;
        })}
      </ul>
    </div>
  );
}

function CredentialTile({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={ready ? "text-sm font-medium" : "text-sm font-medium text-destructive"}>
        {ready ? "Ready" : "Missing"}
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

function statusFromApi(body: SimpleFinStatusApiResponse): SimpleFinSetupStatus {
  return {
    accessUrlConfigured: body.access_url_configured,
    configured: body.configured,
    connectionCount: body.connection_count,
    connections: body.connections.map((connection) => ({
      accountCount: connection.account_count,
      accounts: connection.accounts.map((account) => ({
        balanceAsOf: account.balance_as_of,
        currency: account.currency,
        currentBalance: account.current_balance,
        id: account.id,
        name: account.name,
        standby: account.standby,
        type: account.type
      })),
      errorMessage: connection.error_message,
      id: connection.id,
      lastSyncedAt: connection.last_synced_at,
      name: connection.name,
      status: connection.status,
      transactionCount: connection.transaction_count
    })),
    lastErrors: body.last_errors,
    lastSyncedAt: body.last_synced_at,
    latestBalanceAsOf: body.latest_balance_as_of,
    readyForSync: body.ready_for_sync,
    storedAccountCount: body.stored_account_count,
    storedTransactionCount: body.stored_transaction_count
  };
}

function formatSimpleFinError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : undefined;
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.msg === "string"
          ? record.msg
          : undefined;
    return [code, message].filter(Boolean).join(": ") || JSON.stringify(error);
  }

  return String(error);
}
