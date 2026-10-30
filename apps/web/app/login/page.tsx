import { LoginView } from "@/components/login-view";
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
    <LoginView
      googleEnabled={isGoogleAuthEnabled(env)}
      hosted={hosted}
      invalid={invalid}
      legacyToken={legacyToken}
      mode={firstRun ? "sign-up" : "sign-in"}
      nextPath={nextPath}
    />
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
