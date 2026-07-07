import { apiKey } from "@better-auth/api-key";
import { passkey, type PasskeyOptions } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { getSessionCookie } from "better-auth/cookies";
import { Pool } from "pg";
import type { NextRequest } from "next/server";
import { evaluatePasswordSignInMfaPolicy } from "@/lib/mfa-policy";

export const authCookieName = "af_session";
export const loginPath = "/login";
export const betterAuthBasePath = "/api/better-auth";

const bearerPattern = /^Bearer\s+(.+)$/i;
const encoder = new TextEncoder();
type BetterAuthRuntime = {
  api: {
    getSession(options: { headers: Headers }): Promise<unknown>;
  };
  handler(request: Request): Promise<Response>;
};

let betterAuthInstance: BetterAuthRuntime | null = null;
let betterAuthPool: Pool | null = null;

interface ApiAuthResult {
  authenticated: boolean;
  method?: "api_key" | "better_auth_session" | "legacy" | "open";
}

export function getConfiguredAuthToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.AI_FINANCES_AUTH_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function isHostedAuthMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

export function isGoogleAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
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

export function hasBetterAuthSessionCookie(request: Request | NextRequest): boolean {
  return Boolean(getSessionCookie(request));
}

export async function authenticateApiRequest(
  request: Request | NextRequest,
  env: NodeJS.ProcessEnv = process.env
): Promise<ApiAuthResult> {
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

  const session = await getBetterAuth().api.getSession({
    headers: request.headers
  });

  if (session) {
    return {
      authenticated: true,
      method: bearerToken ? "api_key" : "better_auth_session"
    };
  }

  return { authenticated: false };
}

export function getBetterAuth(): BetterAuthRuntime {
  if (betterAuthInstance) {
    return betterAuthInstance;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("better-auth is disabled because DATABASE_URL is not set.");
  }

  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required when DATABASE_URL is set.");
  }

  betterAuthPool = new Pool({ connectionString: databaseUrl });
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  const auth = betterAuth({
    appName: "Koban",
    basePath: betterAuthBasePath,
    baseURL: process.env.BETTER_AUTH_URL?.trim() || undefined,
    database: betterAuthPool,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await isBetterAuthRegistrationOpen())) {
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
      passkey(getPasskeyOptions()),
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
  return auth;
}

function getPasskeyOptions(): PasskeyOptions {
  const baseUrl = process.env.BETTER_AUTH_URL?.trim();
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

export async function isBetterAuthRegistrationOpen(): Promise<boolean> {
  if (!isHostedAuthMode()) {
    return false;
  }

  const result = await getBetterAuthPool().query<{ count: string }>('SELECT COUNT(*)::int AS count FROM "user"');
  return canCreateBetterAuthUser(Number.parseInt(result.rows[0]?.count ?? "0", 10));
}

export function setBetterAuthForTests(auth: BetterAuthRuntime | null): void {
  betterAuthInstance = auth;
}

function getBetterAuthPool(): Pool {
  getBetterAuth();

  if (!betterAuthPool) {
    throw new Error("better-auth pool was not initialized.");
  }

  return betterAuthPool;
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
