"use client";

import { Check, KeyRound, Loader2, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useMemo, useReducer, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

interface SecuritySettingsPanelProps {
  hostedAuth: boolean;
}

interface AuthClientError {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
}

interface TotpEnableData {
  backupCodes?: string[];
  status?: boolean;
  totpURI?: string;
}

interface HostedSecurityState {
  addingPasskey: boolean;
  backupCodes: string[];
  deletingPasskeyId: string | null;
  errorMessage: string;
  message: string;
  passkeyName: string;
  totpBusy: boolean;
  totpCode: string;
  totpDisablePassword: string;
  totpPassword: string;
  totpUri: string;
}

interface HostedPasskey {
  backedUp?: boolean | null;
  createdAt?: Date | string | null;
  deviceType?: string | null;
  id: string;
  name?: string | null;
}

type HostedSecurityAction = {
  type: "patch";
  patch: Partial<HostedSecurityState>;
};

const INITIAL_HOSTED_SECURITY_STATE: HostedSecurityState = {
  addingPasskey: false,
  backupCodes: [],
  deletingPasskeyId: null,
  errorMessage: "",
  message: "",
  passkeyName: "",
  totpBusy: false,
  totpCode: "",
  totpDisablePassword: "",
  totpPassword: "",
  totpUri: ""
};

function hostedSecurityReducer(state: HostedSecurityState, action: HostedSecurityAction): HostedSecurityState {
  return { ...state, ...action.patch };
}

const securityDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});

export function SecuritySettingsPanel({ hostedAuth }: SecuritySettingsPanelProps) {
  if (!hostedAuth) {
    return <LocalSecurityNote />;
  }

  return <HostedSecurityPanel />;
}

function HostedSecurityPanel() {
  const session = authClient.useSession();
  const passkeyQuery = authClient.useListPasskeys();
  const passkeys = passkeyQuery.data ?? [];
  const twoFactorEnabled = (session.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled === true;

  const [state, dispatch] = useReducer(hostedSecurityReducer, INITIAL_HOSTED_SECURITY_STATE);
  const {
    addingPasskey,
    backupCodes,
    deletingPasskeyId,
    errorMessage,
    message,
    passkeyName,
    totpBusy,
    totpCode,
    totpDisablePassword,
    totpPassword,
    totpUri
  } = state;
  const totpSecret = useMemo(() => extractTotpSecret(totpUri), [totpUri]);

  function updateState(patch: Partial<HostedSecurityState>) {
    dispatch({ type: "patch", patch });
  }

  async function addPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateState({ addingPasskey: true });
    clearNotices();

    try {
      if (typeof PublicKeyCredential === "undefined") {
        throw new Error("This browser does not expose WebAuthn passkeys.");
      }

      const result = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || undefined
      });

      if (result.error) {
        throw new Error(formatAuthError(result.error, "Passkey enrollment failed."));
      }

      updateState({ message: "Passkey enrolled for this Koban account.", passkeyName: "" });
      await passkeyQuery.refetch();
    } catch (error) {
      updateState({ errorMessage: error instanceof Error ? error.message : "Passkey enrollment failed." });
    } finally {
      updateState({ addingPasskey: false });
    }
  }

  async function deletePasskey(passkeyId: string) {
    updateState({ deletingPasskeyId: passkeyId });
    clearNotices();

    try {
      const result = await authClient.$fetch("/passkey/delete-passkey", {
        body: { id: passkeyId },
        method: "POST",
        throw: false
      }) as { error?: AuthClientError | null };

      if (result.error) {
        throw new Error(formatAuthError(result.error, "Passkey could not be removed."));
      }

      updateState({ message: "Passkey removed." });
      await passkeyQuery.refetch();
    } catch (error) {
      updateState({ errorMessage: error instanceof Error ? error.message : "Passkey could not be removed." });
    } finally {
      updateState({ deletingPasskeyId: null });
    }
  }

  async function startTotpEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateState({ totpBusy: true });
    clearNotices();

    try {
      const result = await authClient.twoFactor.enable({
        issuer: "Koban",
        password: totpPassword || undefined
      });

      if (result.error) {
        throw new Error(formatAuthError(result.error, "TOTP setup could not be started."));
      }

      const data = result.data as TotpEnableData | null;
      if (!data?.totpURI) {
        throw new Error("TOTP setup did not return an authenticator URI.");
      }

      updateState({
        backupCodes: data.backupCodes ?? [],
        message: "Scan the QR code, then verify the code from your authenticator app.",
        totpCode: "",
        totpUri: data.totpURI
      });
    } catch (error) {
      updateState({ errorMessage: error instanceof Error ? error.message : "TOTP setup could not be started." });
    } finally {
      updateState({ totpBusy: false });
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateState({ totpBusy: true });
    clearNotices();

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: normalizeTotpCode(totpCode),
        trustDevice: false
      });

      if (result.error) {
        throw new Error(formatAuthError(result.error, "TOTP code was not accepted."));
      }

      updateState({
        backupCodes: [],
        message: "TOTP is enabled for this Koban account.",
        totpCode: "",
        totpPassword: "",
        totpUri: ""
      });
      await session.refetch();
    } catch (error) {
      updateState({ errorMessage: error instanceof Error ? error.message : "TOTP code was not accepted." });
    } finally {
      updateState({ totpBusy: false });
    }
  }

  async function disableTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateState({ totpBusy: true });
    clearNotices();

    try {
      const result = await authClient.twoFactor.disable({
        password: totpDisablePassword || undefined
      });

      if (result.error) {
        throw new Error(formatAuthError(result.error, "TOTP could not be disabled."));
      }

      updateState({ message: "TOTP is disabled for this Koban account.", totpDisablePassword: "" });
      await session.refetch();
    } catch (error) {
      updateState({ errorMessage: error instanceof Error ? error.message : "TOTP could not be disabled." });
    } finally {
      updateState({ totpBusy: false });
    }
  }

  function clearNotices() {
    updateState({ errorMessage: "", message: "" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Security
        </CardTitle>
        <CardDescription>Manage hosted-mode sign-in factors for this Koban instance.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <PasskeySettingsSection
          addingPasskey={addingPasskey}
          deletingPasskeyId={deletingPasskeyId}
          loading={passkeyQuery.isPending}
          onAddPasskey={addPasskey}
          onDeletePasskey={deletePasskey}
          onPasskeyNameChange={(nextPasskeyName) => updateState({ passkeyName: nextPasskeyName })}
          passkeyName={passkeyName}
          passkeys={passkeys}
        />

        <Separator />

        <TotpSettingsSection
          backupCodes={backupCodes}
          onDisableTotp={disableTotp}
          onStartEnrollment={startTotpEnrollment}
          onTotpCodeChange={(nextTotpCode) => updateState({ totpCode: nextTotpCode })}
          onTotpDisablePasswordChange={(nextPassword) => updateState({ totpDisablePassword: nextPassword })}
          onTotpPasswordChange={(nextPassword) => updateState({ totpPassword: nextPassword })}
          onVerifyTotp={verifyTotp}
          totpBusy={totpBusy}
          totpCode={totpCode}
          totpDisablePassword={totpDisablePassword}
          totpPassword={totpPassword}
          totpSecret={totpSecret}
          totpUri={totpUri}
          twoFactorEnabled={twoFactorEnabled}
        />

        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      </CardContent>
    </Card>
  );
}

function LocalSecurityNote() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Security
        </CardTitle>
        <CardDescription>Hosted authentication is disabled in local zero-setup mode.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This local Koban instance does not use Better Auth because `DATABASE_URL` is not set. Passkeys and TOTP are
          available after deploying hosted mode with PostgreSQL.
        </p>
      </CardContent>
    </Card>
  );
}

function PasskeySettingsSection({
  addingPasskey,
  deletingPasskeyId,
  loading,
  onAddPasskey,
  onDeletePasskey,
  onPasskeyNameChange,
  passkeyName,
  passkeys
}: {
  addingPasskey: boolean;
  deletingPasskeyId: string | null;
  loading: boolean;
  onAddPasskey: (event: FormEvent<HTMLFormElement>) => void;
  onDeletePasskey: (passkeyId: string) => Promise<void>;
  onPasskeyNameChange: (value: string) => void;
  passkeyName: string;
  passkeys: HostedPasskey[];
}) {
  return (
    <section className="grid gap-3" aria-labelledby="passkey-settings-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h2 id="passkey-settings-title" className="text-sm font-medium">
            Passkeys
          </h2>
          <p className="text-sm text-muted-foreground">
            Phishing-resistant sign-in with a device authenticator or security key.
          </p>
        </div>
        <Badge appearance="dot" dotColor={passkeys.length > 0 ? "positive" : "muted"} variant="outline">
          {passkeys.length.toLocaleString()} enrolled
        </Badge>
      </div>

      <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={onAddPasskey}>
        <div className="grid gap-2">
          <Label htmlFor="passkey-name">Passkey name</Label>
          <Input
            id="passkey-name"
            maxLength={48}
            onChange={(event) => onPasskeyNameChange(event.currentTarget.value)}
            placeholder="MacBook Touch ID"
            value={passkeyName}
          />
        </div>
        <Button disabled={addingPasskey} type="submit">
          {addingPasskey ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
          Add passkey
        </Button>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading passkeys…</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No passkeys are enrolled yet.</p>
      ) : (
        <div className="grid gap-2">
          {passkeys.map((passkey) => (
            <div
              className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-center"
              key={passkey.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{passkey.name || "Passkey"}</p>
                <p className="text-xs text-muted-foreground">
                  Created {formatSecurityDate(passkey.createdAt)}
                  {passkey.deviceType ? ` · ${passkey.deviceType}` : ""}
                  {passkey.backedUp ? " · synced" : ""}
                </p>
              </div>
              <Button
                className="justify-self-start sm:justify-self-end"
                disabled={deletingPasskeyId === passkey.id}
                onClick={() => void onDeletePasskey(passkey.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                {deletingPasskeyId === passkey.id ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" aria-hidden="true" />
                )}
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TotpSettingsSection({
  backupCodes,
  onDisableTotp,
  onStartEnrollment,
  onTotpCodeChange,
  onTotpDisablePasswordChange,
  onTotpPasswordChange,
  onVerifyTotp,
  totpBusy,
  totpCode,
  totpDisablePassword,
  totpPassword,
  totpSecret,
  totpUri,
  twoFactorEnabled
}: {
  backupCodes: string[];
  onDisableTotp: (event: FormEvent<HTMLFormElement>) => void;
  onStartEnrollment: (event: FormEvent<HTMLFormElement>) => void;
  onTotpCodeChange: (value: string) => void;
  onTotpDisablePasswordChange: (value: string) => void;
  onTotpPasswordChange: (value: string) => void;
  onVerifyTotp: (event: FormEvent<HTMLFormElement>) => void;
  totpBusy: boolean;
  totpCode: string;
  totpDisablePassword: string;
  totpPassword: string;
  totpSecret: string;
  totpUri: string;
  twoFactorEnabled: boolean;
}) {
  return (
    <section className="grid gap-3" aria-labelledby="totp-settings-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h2 id="totp-settings-title" className="text-sm font-medium">
            Authenticator app
          </h2>
          <p className="text-sm text-muted-foreground">TOTP is the fallback second factor for password sign-in.</p>
        </div>
        <Badge appearance="dot" dotColor={twoFactorEnabled ? "positive" : "muted"} variant="outline">
          {twoFactorEnabled ? "Enabled" : "Not enabled"}
        </Badge>
      </div>

      {twoFactorEnabled ? (
        <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={onDisableTotp}>
          <div className="grid gap-2">
            <Label htmlFor="totp-disable-password">Current password</Label>
            <Input
              id="totp-disable-password"
              onChange={(event) => onTotpDisablePasswordChange(event.currentTarget.value)}
              type="password"
              value={totpDisablePassword}
              autoComplete="current-password"
            />
          </div>
          <Button disabled={totpBusy} type="submit" variant="outline">
            {totpBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Smartphone className="size-4" aria-hidden="true" />}
            Disable TOTP
          </Button>
        </form>
      ) : (
        <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={onStartEnrollment}>
          <div className="grid gap-2">
            <Label htmlFor="totp-password">Current password</Label>
            <Input
              id="totp-password"
              onChange={(event) => onTotpPasswordChange(event.currentTarget.value)}
              type="password"
              value={totpPassword}
              autoComplete="current-password"
            />
            <p className="text-xs text-muted-foreground">
              Required for password accounts; passwordless accounts can leave it blank.
            </p>
          </div>
          <Button disabled={totpBusy} type="submit" variant="outline">
            {totpBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Smartphone className="size-4" aria-hidden="true" />}
            Set up TOTP
          </Button>
        </form>
      )}

      {totpUri ? (
        <TotpEnrollmentPanel
          backupCodes={backupCodes}
          onTotpCodeChange={onTotpCodeChange}
          onVerifyTotp={onVerifyTotp}
          totpBusy={totpBusy}
          totpCode={totpCode}
          totpSecret={totpSecret}
          totpUri={totpUri}
        />
      ) : null}
    </section>
  );
}

function TotpEnrollmentPanel({
  backupCodes,
  onTotpCodeChange,
  onVerifyTotp,
  totpBusy,
  totpCode,
  totpSecret,
  totpUri
}: {
  backupCodes: string[];
  onTotpCodeChange: (value: string) => void;
  onVerifyTotp: (event: FormEvent<HTMLFormElement>) => void;
  totpBusy: boolean;
  totpCode: string;
  totpSecret: string;
  totpUri: string;
}) {
  return (
    <div className="grid gap-4 rounded-md border border-primary/20 bg-primary/5 p-3">
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="rounded-md border border-border bg-white p-3">
          <QRCodeSVG bgColor="#ffffff" fgColor="#111111" level="M" marginSize={2} size={156} title="Koban TOTP QR code" value={totpUri} />
        </div>
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Authenticator secret</p>
          <code className="break-all rounded-md bg-background px-3 py-2 text-xs text-foreground ring-1 ring-border">
            {totpSecret || totpUri}
          </code>
          <p className="text-xs text-muted-foreground">Store backup codes now; they are shown only during setup.</p>
        </div>
      </div>

      {backupCodes.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Backup codes</p>
          <div className="grid gap-1 rounded-md bg-background p-3 text-xs font-mono tabular-nums ring-1 ring-border sm:grid-cols-2">
            {backupCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
        </div>
      ) : null}

      <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={onVerifyTotp}>
        <div className="grid gap-2">
          <Label htmlFor="totp-code">Verification code</Label>
          <Input
            autoComplete="one-time-code"
            className="font-mono tabular-nums"
            id="totp-code"
            inputMode="numeric"
            maxLength={8}
            onChange={(event) => onTotpCodeChange(event.currentTarget.value)}
            value={totpCode}
          />
        </div>
        <Button disabled={totpBusy || normalizeTotpCode(totpCode).length < 6} type="submit">
          {totpBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
          Verify TOTP
        </Button>
      </form>
    </div>
  );
}

function formatAuthError(error: AuthClientError, fallback: string): string {
  return error.message || error.code || fallback;
}

function normalizeTotpCode(code: string): string {
  return code.replace(/\D/g, "").slice(0, 8);
}

function extractTotpSecret(uri: string): string {
  if (!uri) {
    return "";
  }

  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function formatSecurityDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return securityDateFormatter.format(date);
}
