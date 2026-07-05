"use client";

import { Building2, Landmark } from "lucide-react";
import Script from "next/script";
import { useReducer, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { TellerSetupStatus } from "@/lib/teller-server";

interface TellerConnectInstance {
  open(): void;
}

interface TellerConnectEnrollment {
  accessToken: string;
  user: {
    id: string;
  };
  enrollment: {
    id: string;
    institution?: {
      name?: string;
    };
  };
  signatures?: string[];
}

interface TellerConnectOptions {
  applicationId: string;
  environment: string;
  products: string[];
  selectAccount: "multiple";
  nonce: string;
  onSuccess(enrollment: TellerConnectEnrollment): void;
  onExit(): void;
}

declare global {
  interface Window {
    TellerConnect?: {
      setup(options: TellerConnectOptions): TellerConnectInstance;
    };
  }
}

interface ConnectConfig {
  applicationId: string;
  environment: string;
  products: string[];
  selectAccount: "multiple";
  nonce: string;
}

interface EnrollmentSaveResponse {
  verification: "verified" | "skipped" | "failed";
  status: TellerSetupStatus;
}

interface SyncResponse {
  accountCount: number;
  transactionCount: number;
  enrollmentCount: number;
  errors: string[];
  lastSyncedAt: string;
  status: TellerSetupStatus;
}

interface LocalDataResetResponse {
  account_count?: number;
  error?: string;
  object?: "local_data_reset";
  source_item_count?: number;
  transaction_count?: number;
}

interface TellerConnectState {
  accountTest: string;
  busy: boolean;
  error: string;
  message: string;
  status: TellerSetupStatus;
  syncSummary: string;
}

type TellerConnectAction = {
  type: "patch";
  patch: Partial<TellerConnectState>;
};

function tellerConnectReducer(state: TellerConnectState, action: TellerConnectAction): TellerConnectState {
  return { ...state, ...action.patch };
}

export function TellerConnectSetup({ initialStatus }: { initialStatus: TellerSetupStatus }) {
  const [state, dispatch] = useReducer(tellerConnectReducer, initialStatus, (status): TellerConnectState => ({
    accountTest: "",
    busy: false,
    error: "",
    message: "",
    status,
    syncSummary: ""
  }));
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.TellerConnect)
  );
  const { accountTest, busy, error, message, status, syncSummary } = state;

  function updateState(patch: Partial<TellerConnectState>) {
    dispatch({ type: "patch", patch });
  }

  async function refreshStatus() {
    const response = await fetch("/api/teller/status", { cache: "no-store" });
    if (response.ok) {
      updateState({ status: (await response.json()) as TellerSetupStatus });
    }
  }

  async function openTellerConnect() {
    updateState({
      accountTest: "",
      busy: true,
      error: "",
      message: "Preparing Teller Connect...",
      syncSummary: ""
    });

    try {
      const configResponse = await fetch("/api/teller/connect-config", { cache: "no-store" });
      const configBody = await configResponse.json();

      if (!configResponse.ok) {
        throw new Error(configBody.error ?? "Unable to prepare Teller Connect.");
      }

      const config = configBody as ConnectConfig;

      if (!window.TellerConnect) {
        throw new Error("Teller Connect script has not loaded yet.");
      }

      const tellerConnect = window.TellerConnect.setup({
        applicationId: config.applicationId,
        environment: config.environment,
        products: config.products,
        selectAccount: config.selectAccount,
        nonce: config.nonce,
        onSuccess: async (enrollment) => {
          try {
            updateState({ message: "Saving Teller enrollment locally..." });

            const saveResponse = await fetch("/api/teller/enrollment", {
              body: JSON.stringify({
                ...enrollment,
                environment: config.environment,
                nonce: config.nonce
              }),
              headers: {
                "Content-Type": "application/json"
              },
              method: "POST"
            });
            const saveBody = (await saveResponse.json()) as Partial<EnrollmentSaveResponse> & { error?: string };

            if (!saveResponse.ok) {
              throw new Error(saveBody.error ?? "Unable to save Teller enrollment.");
            }

            await refreshStatus();
            const connectionCount = saveBody.status?.enrollmentCount ?? status.enrollmentCount + 1;
            updateState({
              message: `Connection ${connectionCount} saved${saveBody.verification === "verified" ? " and verified" : ""}. Syncing accounts and transactions…`
            });

            // Saving credentials alone shows nothing — fetch the new
            // institution's accounts immediately so it appears without a
            // manual "Sync Teller data" step.
            const syncResponse = await fetch("/api/teller/sync", { method: "POST" });
            const syncBody = (await syncResponse.json()) as Partial<SyncResponse> & { error?: string };
            await refreshStatus();

            if (syncResponse.ok) {
              updateState({
                message: `Connected and synced: ${syncBody.accountCount ?? 0} accounts, ${syncBody.transactionCount ?? 0} transactions across ${syncBody.enrollmentCount ?? connectionCount} connections.`
              });
            } else {
              updateState({
                error: `Connection saved, but the first sync failed: ${syncBody.error ?? "unknown error"}. Use "Sync Teller data" to retry.`
              });
            }
          } catch (caughtError) {
            updateState({ error: caughtError instanceof Error ? caughtError.message : "Unable to save Teller enrollment." });
          } finally {
            updateState({ busy: false });
          }
        },
        onExit: () => {
          updateState({ busy: false, message: "Teller Connect closed." });
        }
      });

      tellerConnect.open();
    } catch (caughtError) {
      updateState({
        busy: false,
        error: caughtError instanceof Error ? caughtError.message : "Teller setup failed."
      });
    }
  }

  async function testAccounts() {
    updateState({
      accountTest: "",
      busy: true,
      error: "",
      message: "Testing Teller account access...",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/teller/accounts/test", { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Teller account test failed.");
      }

      updateState({
        accountTest: `Teller API reached successfully. Accounts returned: ${body.accountCount}.`,
        message: ""
      });
    } catch (caughtError) {
      updateState({ error: caughtError instanceof Error ? caughtError.message : "Teller account test failed." });
    } finally {
      updateState({ busy: false });
    }
  }

  async function syncTellerData() {
    updateState({
      accountTest: "",
      busy: true,
      error: "",
      message: "Syncing Teller accounts and transactions...",
      syncSummary: ""
    });

    try {
      const response = await fetch("/api/teller/sync", { method: "POST" });
      const body = (await response.json()) as Partial<SyncResponse> & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Teller sync failed.");
      }

      await refreshStatus();
      updateState({
        message: "",
        syncSummary: `Synced ${body.accountCount ?? 0} accounts and ${body.transactionCount ?? 0} transactions from ${body.enrollmentCount ?? 0} Teller connections.`
      });

      if (body.errors?.length) {
        updateState({ error: `Partial sync: ${body.errors.join(" ")}` });
      }
    } catch (caughtError) {
      updateState({ error: caughtError instanceof Error ? caughtError.message : "Teller sync failed." });
    } finally {
      updateState({ busy: false });
    }
  }

  const canOpenConnect = status.readyForConnect && scriptReady && !busy;
  const canTestAccounts = status.readyForApi && !busy;
  const canSync = status.readyForApi && !busy;
  const hasConnection = status.enrollmentCount > 0;

  return (
    <Card size="sm" data-testid="teller-setup-panel">
      <Script
        onError={() => updateState({ error: "Could not load Teller Connect from cdn.teller.io." })}
        onLoad={() => setScriptReady(true)}
        src="https://cdn.teller.io/connect/connect.js"
        strategy="afterInteractive"
      />
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Bank accounts</h2>
          <p className="text-sm text-muted-foreground">
            Link a bank with Teller Connect to load accounts and transactions into the app.
          </p>
        </div>
        <Button disabled={!canOpenConnect} onClick={openTellerConnect} type="button">
          {busy ? "Working..." : hasConnection ? "Add another bank account" : "Connect bank account"}
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {hasConnection ? (
          <div className="flex flex-col gap-2" aria-label="Bank connections">
            {status.connections.map((connection) => (
              <div
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3"
                key={connection.enrollmentIdSuffix}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Landmark className="size-4" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {connection.institutionName ?? `Connection …${connection.enrollmentIdSuffix}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Connected {formatConnectionDate(connection.createdAt)}
                    {connection.environment ? ` · ${connection.environment}` : ""} · …
                    {connection.enrollmentIdSuffix}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-(--positive)" aria-hidden />
                    Connected
                  </Badge>
                </div>
              </div>
            ))}
            <p className="px-1 text-xs text-muted-foreground">
              {status.storedAccountCount.toLocaleString()} accounts ·{" "}
              {status.storedTransactionCount.toLocaleString()} transactions across{" "}
              {status.enrollmentCount.toLocaleString()}{" "}
              {status.enrollmentCount === 1 ? "connection" : "connections"}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Building2 className="size-5" aria-hidden />
            </div>
            <p className="text-sm font-medium">Connect your first bank</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {status.readyForConnect
                ? "Launch Teller Connect to securely link an institution and pull your accounts and transactions."
                : "Add TELLER_APPLICATION_ID to your ignored .env to enable Teller Connect."}
            </p>
          </div>
        )}

        {status.readyForApi ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!canTestAccounts} onClick={testAccounts} type="button">
              Test account access
            </Button>
            <Button variant="outline" size="sm" disabled={!canSync} onClick={syncTellerData} type="button">
              Sync Teller data
            </Button>
          </div>
        ) : null}

        <div>
          <Separator className="mb-3" />
          <p className="mb-2 text-xs font-medium text-muted-foreground">Credential status</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Teller setup status">
            <CredentialTile label="Application" ready={status.applicationConfigured} />
            <CredentialTile label="Certificate" ready={status.certificateConfigured} />
            <CredentialTile label="Private key" ready={status.privateKeyConfigured} />
            <CredentialTile label="Access token" ready={status.accessTokenConfigured} />
            <CredentialTile label="Signature key" ready={status.tokenSigningKeyConfigured} optional />
            <ValueTile label="Environment" value={status.environment} />
          </div>
        </div>

        {hasConnection ? (
          <p className="text-sm text-muted-foreground">
            {status.enrollmentCount} Teller {status.enrollmentCount === 1 ? "connection is" : "connections are"} saved
            locally.{status.latestInstitutionName ? ` Latest: ${status.latestInstitutionName}.` : ""}
          </p>
        ) : null}
        {!scriptReady ? <p className="text-sm text-muted-foreground">Loading Teller Connect...</p> : null}
        {!status.readyForConnect ? (
          <p className="text-sm text-destructive">Add `TELLER_APPLICATION_ID` to ignored `.env` first.</p>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {accountTest ? <p className="text-sm text-muted-foreground">{accountTest}</p> : null}
        {syncSummary ? <p className="text-sm text-muted-foreground">{syncSummary}</p> : null}
        {status.lastLedgerSyncedAt ? (
          <p className="text-sm text-muted-foreground">
            Last Teller data sync: {new Date(status.lastLedgerSyncedAt).toLocaleString()}.
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

export function LocalDataPanel({ initialStatus }: { initialStatus: TellerSetupStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [localDataMessage, setLocalDataMessage] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");

  async function refreshStatus() {
    const response = await fetch("/api/teller/status", { cache: "no-store" });
    if (response.ok) {
      setStatus((await response.json()) as TellerSetupStatus);
    }
  }

  async function exportBackup() {
    setBusy(true);
    setError("");
    setBackupMessage("");
    setLocalDataMessage("");

    try {
      const response = await fetch("/api/v1/backups/teller-ledger", { cache: "no-store" });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Unable to export Teller backup.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "ai-finances-teller-ledger.json";

      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupMessage("Teller ledger backup exported from the local database.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to export Teller backup.");
    } finally {
      setBusy(false);
    }
  }

  async function importBackup(file: File | undefined) {
    if (!file || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setBackupMessage("");
    setLocalDataMessage("");

    try {
      const content = await file.text();
      const response = await fetch("/api/v1/backups/teller-ledger", {
        body: JSON.stringify({ content }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as {
        account_count?: number;
        error?: string;
        transaction_count?: number;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to import Teller backup.");
      }

      await refreshStatus();
      setBackupMessage(
        `Imported backup into the local database: ${body.account_count ?? 0} accounts and ${body.transaction_count ?? 0} transactions.`
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to import Teller backup.");
    } finally {
      setBusy(false);
    }
  }

  async function resetLocalData() {
    if (busy || resetConfirmation !== "DELETE LOCAL DATA") {
      return;
    }

    setBusy(true);
    setError("");
    setBackupMessage("");
    setLocalDataMessage("");

    try {
      const response = await fetch("/api/v1/local-data/reset", {
        body: JSON.stringify({ confirmation: resetConfirmation }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as LocalDataResetResponse;

      if (!response.ok || body.object !== "local_data_reset") {
        throw new Error(body.error ?? "Unable to clear local app data.");
      }

      setResetConfirmation("");
      setLocalDataMessage(
        `Cleared local runtime data: ${body.account_count ?? 0} accounts, ${body.transaction_count ?? 0} transactions, and ${body.source_item_count ?? 0} source records. Teller credentials and backup files were not deleted.`
      );
      await refreshStatus();
      window.setTimeout(() => {
        window.location.reload();
      }, 700);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to clear local app data.");
    } finally {
      setBusy(false);
    }
  }

  const canBackup = status.storedTransactionCount > 0 && !busy;
  const canResetLocalData = resetConfirmation === "DELETE LOCAL DATA" && !busy;

  return (
    <div className="flex flex-col gap-6">
      <Card size="sm">
        <CardHeader className="border-b pb-4">
          <h2 className="text-base font-medium">Backup &amp; restore</h2>
          <p className="text-sm text-muted-foreground">
            Export the local Teller ledger to a JSON file, or import a previously exported backup into the local
            database.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={!canBackup} onClick={exportBackup} type="button">
              Export backup
            </Button>
            <label
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer",
                busy && "pointer-events-none opacity-50"
              )}
            >
              {busy ? "Working..." : "Import backup"}
              <input
                accept=".json,application/json,text/plain"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  void importBackup(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
          </div>
          {backupMessage ? <p className="text-sm text-muted-foreground">{backupMessage}</p> : null}
        </CardContent>
      </Card>

      <Card size="sm" aria-label="Local data reset section">
        <CardHeader className="border-b border-destructive/30 pb-4">
          <h2 className="text-base font-medium text-destructive">Danger zone</h2>
          <p className="text-sm text-muted-foreground">
            Clear the local PGlite runtime database when you need to rebuild from Teller and real source imports. This
            does not delete ignored `.env` credentials or exported backup files.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="local-data-reset-input">Type DELETE LOCAL DATA</Label>
            <Input
              id="local-data-reset-input"
              aria-label="Local data reset confirmation"
              className="max-w-xs font-mono"
              disabled={busy}
              onChange={(event) => setResetConfirmation(event.target.value)}
              placeholder="DELETE LOCAL DATA"
              type="text"
              value={resetConfirmation}
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="w-fit"
            disabled={!canResetLocalData}
            onClick={resetLocalData}
            type="button"
          >
            Clear local runtime data
          </Button>
          {localDataMessage ? <p className="text-sm text-muted-foreground">{localDataMessage}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function CredentialTile({ label, ready, optional = false }: { label: string; ready: boolean; optional?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-medium",
          ready ? "text-foreground" : optional ? "text-muted-foreground" : "text-destructive"
        )}
      >
        {ready ? "Ready" : optional ? "Optional" : "Missing"}
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

const connectionDateFormatter = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

function formatConnectionDate(iso?: string) {
  if (!iso) {
    return "date unknown";
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "date unknown" : connectionDateFormatter.format(parsed);
}
