import { apiKey } from "@better-auth/api-key";
import { passkey, type PasskeyOptions } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";
import type { NextRequest } from "next/server";
import { evaluatePasswordSignInMfaPolicy } from "@/lib/mfa-policy";
import { readWorkspaceEnv } from "@/lib/workspace-env";
import { isPublicDemo } from "@/lib/public-demo";

export const authCookieName = "af_session";
export const loginPath = "/login";
export const betterAuthBasePath = "/api/better-auth";

const bearerPattern = /^Bearer\s+(.+)$/i;
const encoder = new TextEncoder();
type AuthEnvironment = Readonly<Record<string, string | undefined>>;
type BetterAuthRuntime = {
  api: {
    getSession(options: { headers: Headers }): Promise<unknown>;
  };
  handler(request: Request): Promise<Response>;
};

let betterAuthInstance: BetterAuthRuntime | null = null;
let betterAuthPool: Pool | null = null;
let betterAuthConfigKey: string | null = null;
let betterAuthTestOverride = false;

interface ApiAuthResult {
  authenticated: boolean;
  method?: "api_key" | "better_auth_session" | "legacy" | "open" | "public_demo";
}

export function getConfiguredAuthToken(env: AuthEnvironment = readWorkspaceEnv()): string | undefined {
  const token = env.AI_FINANCES_AUTH_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function isHostedAuthMode(env: AuthEnvironment = readWorkspaceEnv()): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

export function isGoogleAuthEnabled(env: AuthEnvironment = readWorkspaceEnv()): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function canCreateBetterAuthUser(existingUserCount: number): boolean {
  return existingUserCount === 0;
}

export function getBearerToken(authorizationHeader: string | null): string | undefined {
  const match = authorizationHeader?.match(bearerPattern);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function constantTimeTokenEquals(candidate: string | undefined, expected: string): boolean {
  if (!candidate || expected.length === 0) {
    return false;
  }

  const candidateBytes = encoder.encode(candidate);
  const expectedBytes = encoder.encode(expected);
  const maxLength = Math.max(candidateBytes.length, expectedBytes.length, 1);
  let mismatch = candidateBytes.length ^ expectedBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    const candidateByte = candidateBytes.length === 0 ? 0 : candidateBytes[index % candidateBytes.length];
    const expectedByte = expectedBytes.length === 0 ? 0 : expectedBytes[index % expectedBytes.length];
    mismatch |= candidateByte ^ expectedByte;
  }

  return mismatch === 0;
}

export async function authenticateApiRequest(
  request: Request | NextRequest,
  env: AuthEnvironment = readWorkspaceEnv()
): Promise<ApiAuthResult> {
  if (isPublicDemo(env)) {
    return { authenticated: true, method: "public_demo" };
  }

  const expectedToken = getConfiguredAuthToken(env);
  const bearerToken = getBearerToken(request.headers.get("authorization"));

  if (expectedToken && constantTimeTokenEquals(bearerToken, expectedToken)) {
    return { authenticated: true, method: "legacy" };
  }

  if (!isHostedAuthMode(env)) {
    if (!expectedToken) {
      return { authenticated: true, method: "open" };
    }

    if (constantTimeTokenEquals(readCookieValue(request.headers.get("cookie"), authCookieName), expectedToken)) {
      return { authenticated: true, method: "legacy" };
    }

    return { authenticated: false };
  }

  let session: unknown;
  try {
    session = await getBetterAuth(env).api.getSession({
      headers: request.headers
    });
  } catch (error) {
    if (isBetterAuthCredentialError(error)) {
      return { authenticated: false };
    }

    throw error;
  }

  if (session) {
    return {
      authenticated: true,
      method: bearerToken ? "api_key" : "better_auth_session"
    };
  }

  return { authenticated: false };
}

export function getBetterAuth(env: AuthEnvironment = readWorkspaceEnv()): BetterAuthRuntime {
  if (betterAuthInstance && betterAuthTestOverride) {
    return betterAuthInstance;
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("better-auth is disabled because DATABASE_URL is not set.");
  }

  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required when DATABASE_URL is set.");
  }

  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const baseUrl = env.BETTER_AUTH_URL?.trim();
  const configKey = JSON.stringify([
    databaseUrl,
    secret,
    baseUrl ?? "",
    googleClientId ?? "",
    googleClientSecret ?? ""
  ]);

  if (betterAuthInstance) {
    if (betterAuthConfigKey !== configKey) {
      throw new Error("better-auth configuration changed after initialization; restart the server to apply it.");
    }

    return betterAuthInstance;
  }

  betterAuthPool = new Pool({ connectionString: databaseUrl });

  const auth = betterAuth({
    appName: "Koban",
    basePath: betterAuthBasePath,
    baseURL: baseUrl || undefined,
    database: betterAuthPool,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await isBetterAuthRegistrationOpen(env))) {
              throw new APIError("FORBIDDEN", {
                message: "Registration is closed for this Koban instance."
              });
            }

            return { data: user };
          }
        }
      }
    },
    emailAndPassword: {
      enabled: true
    },
    plugins: [
      passkey(getPasskeyOptions(env)),
      twoFactor({
        allowPasswordless: true,
        issuer: "Koban"
      }),
      passwordSignInMfaPolicyPlugin(),
      apiKey({
        customAPIKeyGetter: (ctx) => getBearerToken(ctx.headers?.get("authorization") ?? null) ?? null,
        defaultPrefix: "af_",
        enableSessionForAPIKeys: true,
        rateLimit: {
          enabled: false
        },
        requireName: true
      }),
      nextCookies()
    ],
    socialProviders: googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret
          }
        }
      : undefined
  });

  betterAuthInstance = auth;
  betterAuthConfigKey = configKey;
  return auth;
}

function getPasskeyOptions(env: AuthEnvironment): PasskeyOptions {
  const baseUrl = env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) {
    return {
      rpName: "Koban"
    };
  }

  try {
    const origin = new URL(baseUrl).origin;
    return {
      origin,
      rpID: new URL(origin).hostname,
      rpName: "Koban"
    };
  } catch {
    return {
      rpName: "Koban"
    };
  }
}

function passwordSignInMfaPolicyPlugin(): BetterAuthPlugin {
  return {
    id: "koban-mfa-policy",
    hooks: {
      before: [
        {
          matcher(context) {
            return context.path === "/sign-in/email";
          },
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { email?: unknown } | undefined;
            const email = typeof body?.email === "string" ? body.email.trim() : "";
            if (!email) {
              return;
            }

            const user = await ctx.context.adapter.findOne({
              model: "user",
              where: [{
                field: "email",
                mode: "insensitive",
                value: email
              }]
            }) as { id?: unknown; twoFactorEnabled?: unknown } | null;

            if (typeof user?.id !== "string") {
              return;
            }

            const [passkeyRecord, twoFactorRecord] = await Promise.all([
              ctx.context.adapter.findOne({
                model: "passkey",
                where: [{
                  field: "userId",
                  value: user.id
                }]
              }),
              ctx.context.adapter.findOne({
                model: "twoFactor",
                where: [{
                  field: "userId",
                  value: user.id
                }]
              }) as Promise<{ verified?: unknown } | null>
            ]);
            const decision = evaluatePasswordSignInMfaPolicy({
              hasPasskey: Boolean(passkeyRecord),
              hasVerifiedTotp: user.twoFactorEnabled === true && twoFactorRecord?.verified !== false
            });

            if (!decision.allowed) {
              throw new APIError("FORBIDDEN", {
                message: decision.reason ?? "Use a second factor to sign in to Koban."
              });
            }
          })
        }
      ]
    }
  };
}

export async function isBetterAuthRegistrationOpen(env: AuthEnvironment = readWorkspaceEnv()): Promise<boolean> {
  if (!isHostedAuthMode(env)) {
    return false;
  }

  const result = await getBetterAuthPool(env).query<{ count: string }>('SELECT COUNT(*)::int AS count FROM "user"');
  return canCreateBetterAuthUser(Number.parseInt(result.rows[0]?.count ?? "0", 10));
}

export function setBetterAuthForTests(auth: BetterAuthRuntime | null): void {
  betterAuthInstance = auth;
  betterAuthConfigKey = null;
  betterAuthTestOverride = auth !== null;
  if (!auth) {
    betterAuthPool = null;
  }
}

function getBetterAuthPool(env: AuthEnvironment = readWorkspaceEnv()): Pool {
  getBetterAuth(env);

  if (!betterAuthPool) {
    throw new Error("better-auth pool was not initialized.");
  }

  return betterAuthPool;
}

function isBetterAuthCredentialError(error: unknown): boolean {
  if (!(error instanceof Error) || (error.name !== "APIError" && !(error instanceof APIError))) {
    return false;
  }

  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const status = "status" in error ? error.status : undefined;
  return statusCode === 401 || statusCode === 403 || status === "UNAUTHORIZED" || status === "FORBIDDEN";
}

function readCookieValue(cookieHeaderOrValue: string | null | undefined, name: string): string | undefined {
  if (!cookieHeaderOrValue) {
    return undefined;
  }

  if (!cookieHeaderOrValue.includes("=")) {
    return cookieHeaderOrValue;
  }

  for (const part of cookieHeaderOrValue.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return undefined;
}
