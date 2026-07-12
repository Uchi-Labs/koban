"use client";

import { CreditCard, Landmark, LinkIcon, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { ProviderConsentLine } from "@/components/provider-consent-line";
import { useToast } from "@/components/ui/toast";
import { ProviderStatusBadge } from "@/components/provider-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/format";
import { playError, playSuccess } from "@/lib/ui-sound";
import type { PlaidItemSummary, PlaidSetupStatus } from "@/lib/plaid-server";

const PLAID_LINK_SESSION_STORAGE_KEY = ["ai-finances", "plaid-link", "state"].join(":");

interface PlaidStatusApiResponse {
  client_id_configured: boolean;
  configured: boolean;
  environment: PlaidSetupStatus["environment"];
  item_count: number;
  items: PlaidItemApi[];
  last_synced_at?: string;
  ready_for_link: boolean;
  ready_for_sync: boolean;
  redirect_uri_configured: boolean;
  secret_configured: boolean;
  standby_institution_names: string[];
  stored_account_count: number;
  stored_transaction_count: number;
}

interface PlaidItemApi {
  account_count: number;
  accounts: Array<{
    currency: string;
    current_balance: number;
    id: string;
    mask?: string;
    name: string;
    type: PlaidItemSummary["accounts"][number]["type"];
  }>;
  cursor_present: boolean;
  error_message?: string;
  id: string;
  institution_id?: string;
  institution_name: string;
  last_synced_at?: string;
  status: PlaidItemSummary["status"];
  transaction_count: number;
}

interface PlaidConnectState {
  busy: boolean;
  error: string;
  message: string;
  status: PlaidSetupStatus;
  syncSummary: string;
}

type PlaidConnectAction = {
  patch: Partial<PlaidConnectState>;
  type: "patch";
};

function plaidConnectReducer(state: PlaidConnectState, action: PlaidConnectAction): PlaidConnectState {
  return { ...state, ...action.patch };
}

function readPlaidLinkSessionValue(autoOpen: boolean) {
  if (!autoOpen || typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(PLAID_LINK_SESSION_STORAGE_KEY);
}

export function PlaidConnectSetup({
  autoOpen = false,
  detailsOnly = false,
  initialStatus,
  launchRequest = 0
}: {
  autoOpen?: boolean;
  detailsOnly?: boolean;
  initialStatus: PlaidSetupStatus;
  launchRequest?: number;
}) {
  const [state, dispatch] = useReducer(plaidConnectReducer, initialStatus, (status): PlaidConnectState => ({
    busy: false,
    error: "",
    message: "",
    status,
    syncSummary: ""
  }));
  const [linkToken, setLinkToken] = useState<string | null>(() => readPlaidLinkSessionValue(autoOpen));
  const openWhenReadyRef = useRef(Boolean(autoOpen && linkToken));
  const handledLaunchRequest = useRef(launchRequest);
  const receivedRedirectUri = autoOpen && typeof window !== "undefined" ? window.location.href : undefined;
  const { busy, error, message, status, syncSummary } = state;
  const hasItems = status.items.length > 0;

  function updateState(patch: Partial<PlaidConnectState>) {
    dispatch({ type: "patch", patch });
  }

  async function refreshStatus() {
    const response = await fetch("/api/v1/plaid/status", { cache: "no-store" });

    if (response.ok) {
      updateState({ status: statusFromApi((await response.json()) as PlaidStatusApiResponse) });
    }
  }

  async function handleSuccess(publicToken: string, metadata: PlaidLinkOnSuccessMetadata) {
    updateState({
      busy: true,
      error: "",
      message: "Saving Plaid item...",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/v1/plaid/exchange", {
        body: JSON.stringify({
          public_token: publicToken,
          institution_id: metadata.institution?.institution_id,
          institution_name: metadata.institution?.name
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as {
        error?: string;
        status?: PlaidStatusApiResponse;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Plaid token exchange failed.");
      }

      window.sessionStorage.removeItem(PLAID_LINK_SESSION_STORAGE_KEY);
      playSuccess();
      // Toast, not just inline state: this component lives inside a collapsed
      // accordion, so an inline-only message/error is invisible after the widget closes.
      const institution = metadata.institution?.name;
      showToast({
        description: institution ? `${institution} linked. Run Plaid sync to import transactions.` : "Run Plaid sync to import transactions.",
        duration: 5000,
        status: "success",
        title: "Bank connected"
      });
      updateState({
        message: "Plaid item linked. Run Plaid sync to import transactions.",
        status: body.status ? statusFromApi(body.status) : status
      });
      await refreshStatus();
    } catch (caughtError) {
      playError();
      const detail = caughtError instanceof Error ? caughtError.message : "Plaid token exchange failed.";
      showToast({ description: detail, duration: 7000, status: "error", title: "Couldn't finish linking" });
      updateState({ error: detail });
    } finally {
      updateState({ busy: false });
    }
  }

  const { showToast } = useToast();

  // The launch usually starts from the Add-connection chooser, which closes
  // instantly — without a toast, the 2-4s token-fetch + iframe boot reads as
  // "nothing happened", and Link failures were fully silent. A short auto-dismiss
  // toast on launch (not an indefinite loading one) can't hang; errors get their own.
  const { open, ready } = usePlaidLink({
    onExit: (exitError) => {
      if (exitError) {
        playError();
        const detail = exitError.display_message ?? exitError.error_message ?? exitError.error_code ?? "unknown error";
        showToast({ description: detail, duration: 6000, status: "error", title: "Plaid Link failed" });
        updateState({ busy: false, error: `Plaid Link exited: ${detail}` });
      } else {
        updateState({ busy: false });
      }
    },
    onSuccess: handleSuccess,
    receivedRedirectUri,
    token: linkToken
  });
  const openPlaidLink = useEffectEvent(open);

  useEffect(() => {
    if (!openWhenReadyRef.current || !ready || !linkToken) {
      return;
    }

    openWhenReadyRef.current = false;
    openPlaidLink();
  }, [linkToken, ready]);

  useEffect(() => {
    if (!autoOpen || linkToken) {
      return;
    }

    void prepareLinkToken({ openWhenReady: true });
  }, [autoOpen, linkToken]);

  async function prepareLinkToken({ openWhenReady }: { openWhenReady: boolean }) {
    updateState({
      busy: true,
      error: "",
      message: "Preparing Plaid Link...",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/v1/plaid/link-token", {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as {
        error?: string;
        link_token?: string;
      };

      if (!response.ok || !body.link_token) {
        throw new Error(body.error ?? "Unable to create Plaid Link token.");
      }

      window.sessionStorage.setItem(PLAID_LINK_SESSION_STORAGE_KEY, body.link_token);
      openWhenReadyRef.current = openWhenReady;
      setLinkToken(body.link_token);
      updateState({ message: openWhenReady ? "Opening Plaid Link..." : "Plaid Link is ready." });
    } catch (caughtError) {
      playError();
      const detail = caughtError instanceof Error ? caughtError.message : "Unable to create Plaid Link token.";
      showToast({ description: detail, duration: 6000, status: "error", title: "Plaid Link failed" });
      updateState({ error: detail });
    } finally {
      updateState({ busy: false });
    }
  }

  async function linkAccount() {
    showToast({
      description: "Plaid's secure widget is starting — it may take a couple seconds.",
      duration: 3500,
      status: "loading",
      title: "Opening Plaid Link…"
    });

    if (linkToken && ready) {
      open();
      return;
    }

    await prepareLinkToken({ openWhenReady: true });
  }

  const launchPlaidLink = useEffectEvent(linkAccount);

  useEffect(() => {
    if (launchRequest <= handledLaunchRequest.current) {
      return;
    }

    handledLaunchRequest.current = launchRequest;
    void launchPlaidLink();
  }, [launchRequest]);

  async function syncPlaid() {
    updateState({
      busy: true,
      error: "",
      message: "Syncing Plaid transactions...",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/v1/plaid/sync", {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as {
        account_count?: number;
        error?: string;
        errors?: string[];
        item_count?: number;
        removed_transaction_count?: number;
        status?: PlaidStatusApiResponse;
        transaction_count?: number;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Plaid sync failed.");
      }

      await refreshStatus();
      playSuccess();
      updateState({
        message: "",
        status: body.status ? statusFromApi(body.status) : status,
        syncSummary: `Synced ${body.account_count ?? 0} accounts and ${body.transaction_count ?? 0} transactions across ${body.item_count ?? 0} Plaid items.`
      });

      if (body.errors?.length) {
        updateState({ error: `Partial sync: ${body.errors.join(" ")}` });
      }
    } catch (caughtError) {
      playError();
      updateState({ error: caughtError instanceof Error ? caughtError.message : "Plaid sync failed." });
    } finally {
      updateState({ busy: false });
    }
  }

  return (
    <Card size="sm" data-testid="plaid-setup-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Plaid transactions</h2>
          <p className="text-sm text-muted-foreground">
            Manual Transactions sync for Plaid-linked bank and card accounts.
          </p>
        </div>
        <div className="flex max-w-sm flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {!detailsOnly ? (
              <Button variant="tonal" disabled={!status.readyForLink || busy} onClick={linkAccount} type="button">
                <LinkIcon className="size-4" aria-hidden />
                {hasItems ? "Link account" : "Link first account"}
              </Button>
            ) : null}
            <Button variant="outline" disabled={!status.readyForSync || busy} onClick={syncPlaid} type="button">
              {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
              {busy ? "Syncing..." : "Sync Plaid"}
            </Button>
          </div>
          <ProviderConsentLine className="text-right" />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!detailsOnly && hasItems ? (
          <div className="flex flex-col gap-2" aria-label="Plaid items">
            {status.items.map((item) => (
              <PlaidItemRow item={item} key={item.id} />
            ))}
            <p className="px-1 text-xs text-muted-foreground">
              {status.storedAccountCount.toLocaleString()} accounts,{" "}
              {status.storedTransactionCount.toLocaleString()} transactions.
            </p>
          </div>
        ) : !detailsOnly ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Landmark className="size-5" aria-hidden />
            </div>
            <p className="text-sm font-medium">No Plaid items linked</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {status.readyForLink
                ? "Link a Plaid account, then run manual sync."
                : "Add PLAID_CLIENT_ID and PLAID_SECRET to your ignored .env to enable Plaid."}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Plaid setup status">
          <CredentialTile label="Client ID" ready={status.clientIdConfigured} />
          <CredentialTile label="Secret" ready={status.secretConfigured} />
          <ValueTile label="Items" value={status.itemCount.toLocaleString()} />
          <ValueTile label="Cursors" value={status.items.filter((item) => item.cursorPresent).length.toLocaleString()} />
        </div>

        <Separator />

        <p className="text-sm text-muted-foreground">
          SoFi and Discover stay on SimpleFIN standby while their Plaid items are healthy; existing SimpleFIN rows remain stored but are excluded from net-worth and spending metrics.
        </p>
        {status.standbyInstitutionNames.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Standby active for {status.standbyInstitutionNames.join(", ")}.
          </p>
        ) : null}
        {!status.readyForLink ? (
          <p className="text-sm text-destructive">Add `PLAID_CLIENT_ID` and `PLAID_SECRET` to ignored `.env` first.</p>
        ) : null}
        {status.lastSyncedAt ? (
          <p className="text-sm text-muted-foreground">
            Last Plaid sync: {new Date(status.lastSyncedAt).toLocaleString()}.
          </p>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {syncSummary ? <p className="text-sm text-muted-foreground">{syncSummary}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function PlaidItemRow({ item }: { item: PlaidItemSummary }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Landmark className="size-4" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{item.institutionName}</span>
          <span className="truncate text-xs text-muted-foreground">
            {item.lastSyncedAt ? `Synced ${new Date(item.lastSyncedAt).toLocaleString()}` : "Not synced yet"}
            {item.cursorPresent ? ", cursor saved" : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ProviderStatusBadge status={item.status} />
          <Badge variant="outline" className="font-normal tabular-nums">
            {item.accountCount.toLocaleString()} accounts
          </Badge>
        </div>
      </div>
      {item.accounts.length > 0 ? (
        <div className="flex flex-col gap-px border-t border-border pt-2">
          {item.accounts.map((account) => (
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
                  {account.mask ? `, ****${account.mask}` : ""}
                </span>
              </div>
              <span className="ml-auto text-sm font-medium tabular-nums">
                {formatCurrency(account.currentBalance, account.currency)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {item.errorMessage ? <p className="text-xs text-destructive">{item.errorMessage}</p> : null}
    </article>
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

function statusFromApi(body: PlaidStatusApiResponse): PlaidSetupStatus {
  return {
    clientIdConfigured: body.client_id_configured,
    configured: body.configured,
    environment: body.environment,
    itemCount: body.item_count,
    items: body.items.map((item) => ({
      accountCount: item.account_count,
      accounts: item.accounts.map((account) => ({
        currency: account.currency,
        currentBalance: account.current_balance,
        id: account.id,
        mask: account.mask,
        name: account.name,
        type: account.type
      })),
      cursorPresent: item.cursor_present,
      errorMessage: item.error_message,
      id: item.id,
      institutionId: item.institution_id,
      institutionName: item.institution_name,
      lastSyncedAt: item.last_synced_at,
      status: item.status,
      transactionCount: item.transaction_count
    })),
    lastSyncedAt: body.last_synced_at,
    readyForLink: body.ready_for_link,
    readyForSync: body.ready_for_sync,
    redirectUriConfigured: body.redirect_uri_configured,
    secretConfigured: body.secret_configured,
    standbyInstitutionNames: body.standby_institution_names,
    storedAccountCount: body.stored_account_count,
    storedTransactionCount: body.stored_transaction_count
  };
}
