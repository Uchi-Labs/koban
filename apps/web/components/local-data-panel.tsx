"use client";

import { useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useShakeReplay } from "@/lib/transitions";
import { cn } from "@/lib/utils";

interface LocalDataResetResponse {
  account_count?: number;
  error?: string;
  object?: "local_data_reset";
  source_item_count?: number;
  transaction_count?: number;
}

export function LocalDataPanel({ initialTransactionCount }: { initialTransactionCount: number }) {
  const [transactionCount, setTransactionCount] = useState(initialTransactionCount);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [localDataMessage, setLocalDataMessage] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetErrorKey, setResetErrorKey] = useState(0);
  const resetShake = useShakeReplay(resetErrorKey);

  async function exportBackup() {
    setBusy(true);
    setError("");
    setBackupMessage("");
    setLocalDataMessage("");

    try {
      const response = await fetch("/api/v1/backups/ledger", { cache: "no-store" });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Unable to export ledger backup.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "ai-finances-ledger.json";

      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupMessage("Ledger backup exported from the local database.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to export ledger backup.");
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
      const response = await fetch("/api/v1/backups/ledger", {
        body: JSON.stringify({ content: await file.text() }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as {
        account_count?: number;
        error?: string;
        transaction_count?: number;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to import ledger backup.");
      }

      setTransactionCount(body.transaction_count ?? 0);
      setBackupMessage(
        `Imported backup into the local database: ${body.account_count ?? 0} accounts and ${body.transaction_count ?? 0} transactions.`
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to import ledger backup.");
    } finally {
      setBusy(false);
    }
  }

  async function resetLocalData() {
    if (busy) {
      return;
    }

    if (resetConfirmation !== "DELETE LOCAL DATA") {
      setError("Type DELETE LOCAL DATA exactly before clearing local runtime data.");
      setResetErrorKey((current) => current + 1);
      return;
    }

    setBusy(true);
    setError("");
    setBackupMessage("");
    setLocalDataMessage("");

    try {
      const response = await fetch("/api/v1/local-data/reset", {
        body: JSON.stringify({ confirmation: resetConfirmation }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json()) as LocalDataResetResponse;

      if (!response.ok || body.object !== "local_data_reset") {
        throw new Error(body.error ?? "Unable to clear local app data.");
      }

      setResetConfirmation("");
      setTransactionCount(0);
      setLocalDataMessage(
        `Cleared local runtime data: ${body.account_count ?? 0} accounts, ${body.transaction_count ?? 0} transactions, and ${body.source_item_count ?? 0} source records. Credentials and backup files were not deleted.`
      );
      window.setTimeout(() => window.location.reload(), 700);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to clear local app data.");
    } finally {
      setBusy(false);
    }
  }

  const canBackup = transactionCount > 0 && !busy;
  const resetMismatch = resetConfirmation.length > 0 && resetConfirmation !== "DELETE LOCAL DATA";
  const canResetLocalData = resetConfirmation.trim().length > 0 && !busy;

  return (
    <div className="flex flex-col gap-6">
      <Card size="sm">
        <CardHeader className="border-b pb-4">
          <h2 className="text-base font-medium">Backup &amp; restore</h2>
          <p className="text-sm text-muted-foreground">
            Export the local ledger to a JSON file, or import a previously exported backup into the local database.
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
            Clear the local PGlite runtime database when you need to rebuild from connected providers and source imports.
            This does not delete ignored `.env` credentials or exported backup files.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className={cn("t-input-wrap flex flex-col gap-1.5", resetMismatch && "is-error")}>
            <Label htmlFor="local-data-reset-input">Type DELETE LOCAL DATA</Label>
            <Input
              id="local-data-reset-input"
              aria-label="Local data reset confirmation"
              aria-invalid={resetMismatch}
              className={cn("t-input max-w-xs font-mono", resetMismatch && "is-error", resetShake.shaking && "is-shaking")}
              disabled={busy}
              onChange={(event) => setResetConfirmation(event.target.value)}
              placeholder="DELETE LOCAL DATA"
              ref={resetShake.ref as RefObject<HTMLInputElement>}
              type="text"
              value={resetConfirmation}
            />
            <p className="t-error-msg text-xs text-destructive">Type DELETE LOCAL DATA exactly.</p>
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
