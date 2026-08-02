import { HostedLoginForm, LegacyTokenForm } from "@/components/login-form";
import { ManekiMoment } from "@/components/maneki-moment";
import Link from "next/link";
import {
  getConfiguredAuthToken,
  isBetterAuthRegistrationOpen,
  isGoogleAuthEnabled,
  isHostedAuthMode
} from "@/lib/auth";
import { readWorkspaceEnv } from "@/lib/workspace-env";

interface LoginPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const nextPath = firstParam(params.next) ?? "/";
  const invalid = firstParam(params.error) === "1";
  const env = readWorkspaceEnv();
  const hosted = isHostedAuthMode(env);
  const legacyToken = getConfiguredAuthToken(env);
  const firstRun = hosted ? await isBetterAuthRegistrationOpen(env) : false;

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className="grid w-full max-w-sm gap-4">
        {hosted ? (
          <HostedLoginForm
            googleEnabled={isGoogleAuthEnabled(env)}
            mode={firstRun ? "sign-up" : "sign-in"}
            nextPath={nextPath}
          />
        ) : legacyToken ? (
          <LegacyTokenForm invalid={invalid} nextPath={nextPath} />
        ) : (
          <div className="t-stagger is-shown grid w-full justify-items-center gap-3 rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <ManekiMoment className="mb-1" priority size={64} />
            <h1 className="t-stagger-line t-stagger-line--1 text-xl font-semibold tracking-normal">Koban</h1>
            <p className="t-stagger-line t-stagger-line--2 text-sm text-muted-foreground">Local mode is open.</p>
          </div>
        )}
        <footer className="text-center text-xs text-muted-foreground">
          <Link className="underline-offset-4 hover:underline" href="/privacy">
            Privacy Policy
          </Link>
        </footer>
      </div>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
