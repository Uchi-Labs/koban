"use client";

import { KeyRound } from "lucide-react";
import { useState, type FormEvent, type RefObject } from "react";
import { ManekiMoment } from "@/components/maneki-moment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { useShakeReplay } from "@/lib/transitions";
import { cn } from "@/lib/utils";
import { useFinePointerAutoFocus } from "@/lib/hooks/use-fine-pointer-auto-focus";

interface HostedLoginFormProps {
  googleEnabled: boolean;
  mode: "sign-in" | "sign-up";
  nextPath: string;
}

interface LegacyTokenFormProps {
  invalid: boolean;
  nextPath: string;
}

const authBasePath = "/api/better-auth";

export function HostedLoginForm({ googleEnabled, mode, nextPath }: HostedLoginFormProps) {
  const autoFocusRef = useFinePointerAutoFocus<HTMLInputElement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [totpChallenge, setTotpChallenge] = useState<{ methods: string[] } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const shake = useShakeReplay(errorKey);
  const isFirstRun = mode === "sign-up";
  // Passkey is the primary path for returning sign-in; the email + password
  // form is a demoted, opt-in fallback. First-run setup and the TOTP step always
  // show their fields since there is no passkey to fall back on yet.
  const passwordExpanded = isFirstRun || showPassword;

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setTotpChallenge(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "") || email.split("@")[0] || "Owner";
    const endpoint = isFirstRun ? "/sign-up/email" : "/sign-in/email";
    const body = isFirstRun
      ? { callbackURL: nextPath, email, name, password }
      : { callbackURL: nextPath, email, password };

    try {
      const response = await fetch(`${authBasePath}${endpoint}`, {
        body: JSON.stringify(body),
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        twoFactorMethods?: string[];
        twoFactorRedirect?: boolean;
        url?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? (isFirstRun ? "Account creation failed." : "Sign in failed."));
      }

      if (payload?.twoFactorRedirect) {
        setTotpChallenge({ methods: payload.twoFactorMethods ?? [] });
        setTotpCode("");
        return;
      }

      window.location.assign(payload?.url ?? nextPath);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Sign in failed.");
      setErrorKey((current) => current + 1);
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      if (totpChallenge && !totpChallenge.methods.includes("totp")) {
        throw new Error("This Koban login is waiting for a second factor that is not enabled in this UI.");
      }

      const response = await fetch(`${authBasePath}/two-factor/verify-totp`, {
        body: JSON.stringify({
          code: normalizeTotpCode(totpCode),
          trustDevice: false
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? "TOTP code was not accepted.");
      }

      window.location.assign(nextPath);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "TOTP code was not accepted.");
      setErrorKey((current) => current + 1);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPasskey() {
    setBusy(true);
    setError("");
    setTotpChallenge(null);

    try {
      if (typeof PublicKeyCredential === "undefined") {
        throw new Error("This browser does not expose WebAuthn passkeys.");
      }

      const result = await authClient.signIn.passkey();

      if (result.error) {
        throw new Error(result.error.message ?? "Passkey sign in failed.");
      }

      window.location.assign(nextPath);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Passkey sign in failed.");
      setErrorKey((current) => current + 1);
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    setTotpChallenge(null);

    try {
      const response = await fetch(`${authBasePath}/sign-in/social`, {
        body: JSON.stringify({
          callbackURL: nextPath,
          provider: "google"
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { message?: string; url?: string } | null;

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.message ?? "Google sign in failed.");
      }

      window.location.assign(payload.url);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Google sign in failed.");
      setErrorKey((current) => current + 1);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={totpChallenge ? verifyTotp : submitPassword}
      className={cn(
        "t-input t-input-wrap grid w-full max-w-sm gap-5 rounded-lg border border-border bg-card p-6 shadow-sm",
        error && "is-error",
        shake.shaking && "is-shaking"
      )}
      ref={shake.ref as RefObject<HTMLFormElement>}
    >
      <div className="t-stagger is-shown grid justify-items-center gap-2 text-center">
        <ManekiMoment className="mb-1" priority size={64} />
        <h1 className="t-stagger-line t-stagger-line--1 text-xl font-semibold tracking-normal">
          {totpChallenge ? "Verify code" : isFirstRun ? "Create owner account" : "Sign in"}
        </h1>
        <p className="t-stagger-line t-stagger-line--2 text-sm text-muted-foreground">
          {totpChallenge
            ? "Enter the code from your authenticator app."
            : isFirstRun
              ? "Set up the only app account for this deployment."
              : "Use your Koban account."}
        </p>
      </div>

      {totpChallenge ? (
        <div className="grid gap-2">
          <Label htmlFor="totp-code">Authenticator code</Label>
          <Input
            id="totp-code"
            name="totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="font-mono tabular-nums"
            maxLength={8}
            required
            value={totpCode}
            onChange={(event) => setTotpCode(event.currentTarget.value)}
            autoFocus
          />
        </div>
      ) : isFirstRun ? (
        <div className="grid gap-3">
          {googleEnabled ? (
            <>
              <Button disabled={busy} onClick={signInWithGoogle} type="button" variant="outline" size="lg" className="w-full">
                Continue with Google
              </Button>
              <OrDivider label="or with email" />
            </>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required ref={autoFocusRef} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <Button
            disabled={busy}
            onClick={() => void signInWithPasskey()}
            type="button"
            size="lg"
            className="w-full"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            Sign in with passkey
          </Button>

          {googleEnabled ? (
            <Button disabled={busy} onClick={signInWithGoogle} type="button" variant="outline" size="lg" className="w-full">
              Continue with Google
            </Button>
          ) : null}

          {showPassword ? (
            <div className="grid gap-3">
              <OrDivider label="or use your password" />
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email webauthn"
                  required
                  ref={autoFocusRef}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  required
                />
              </div>
            </div>
          ) : (
            <Button
              disabled={busy}
              onClick={() => setShowPassword(true)}
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
            >
              Use password instead
            </Button>
          )}
        </div>
      )}

      <p className="t-error-msg text-sm text-destructive">{error}</p>

      {totpChallenge || passwordExpanded ? (
        <Button disabled={busy} type="submit" size="lg" className="w-full">
          {busy ? "Working…" : totpChallenge ? "Verify code" : isFirstRun ? "Create account" : "Continue"}
        </Button>
      ) : null}
    </form>
  );
}

export function LegacyTokenForm({ invalid, nextPath }: LegacyTokenFormProps) {
  const autoFocusRef = useFinePointerAutoFocus<HTMLInputElement>();
  const shake = useShakeReplay(invalid, { shakeOnMount: invalid });

  return (
    <form
      action="/api/login"
      method="post"
      className={cn(
        "t-input t-input-wrap grid w-full max-w-sm gap-5 rounded-lg border border-border bg-card p-6 shadow-sm",
        invalid && "is-error",
        shake.shaking && "is-shaking"
      )}
      ref={shake.ref as RefObject<HTMLFormElement>}
    >
      <input type="hidden" name="next" value={nextPath} />
      <div className="t-stagger is-shown grid justify-items-center gap-2 text-center">
        <ManekiMoment className="mb-1" priority size={64} />
        <h1 className="t-stagger-line t-stagger-line--1 text-xl font-semibold tracking-normal">Token sign in</h1>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="token">Access token</Label>
        <Input id="token" name="token" type="password" autoComplete="current-password" required ref={autoFocusRef} />
        <p className="t-error-msg text-sm text-destructive">Token was not accepted.</p>
      </div>
      <Button type="submit" size="lg" className="w-full">
        Continue
      </Button>
    </form>
  );
}

function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

function normalizeTotpCode(code: string): string {
  return code.replace(/\D/g, "").slice(0, 8);
}
