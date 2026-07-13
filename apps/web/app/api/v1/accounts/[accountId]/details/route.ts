import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { betterAuthBasePath, getBetterAuth, isHostedAuthMode } from "@/lib/auth";
import { withLockedSyncStateValue } from "@/lib/db/finance-db";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { getFinanceData } from "@/lib/finance-data";
import { getTellerAccountDetails, TellerSetupError } from "@/lib/teller-server";

export const runtime = "nodejs";

const totpFailureLimit = 5;
const totpLockoutMs = 15 * 60 * 1000;
const totpProtectionStatePrefix = "account_details_totp:";
const totpReplayWindowMs = 120 * 1000;

interface TotpProtectionState {
  failedAttempts: number;
  lockedUntil?: string;
  lastAcceptedAt?: string;
  lastAcceptedCodeHash?: string;
}

// Reveal of full account/routing numbers. Numbers are fetched live from Teller
// and never persisted or logged; every call requires a fresh TOTP proof so a
// hijacked session alone can't exfiltrate them.
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId: rawAccountId } = await params;
  const accountId = decodeURIComponent(rawAccountId);

  if (await isDemoModeEnabled()) {
    return NextResponse.json(
      { error: "demo_mode", message: "Demo mode is on — real account numbers stay hidden." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body", message: "Request body must be valid JSON." }, { status: 400 });
  }

  const code = (body as { totp_code?: unknown } | null)?.totp_code;
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "invalid_body", message: "totp_code must be a 6-digit string." },
      { status: 400 }
    );
  }

  if (!isHostedAuthMode()) {
    return NextResponse.json(
      {
        error: "two_factor_unavailable",
        message: "Account numbers require the authenticated mode with two-factor enabled."
      },
      { status: 403 }
    );
  }

  const auth = getBetterAuth();
  const session = await auth.api.getSession({ headers: request.headers }) as {
    user?: { id?: unknown };
  } | null;
  const userId = typeof session?.user?.id === "string" ? session.user.id : "";

  if (!userId) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in again before revealing account numbers." },
      { status: 401 }
    );
  }

  return verifyAndRevealAccountDetails({
    accountId,
    auth,
    code,
    request,
    userId
  });
}

async function verifyAndRevealAccountDetails({
  accountId,
  auth,
  code,
  request,
  userId
}: {
  accountId: string;
  auth: ReturnType<typeof getBetterAuth>;
  code: string;
  request: Request;
  userId: string;
}) {
  const verificationFailure = await verifyTotpWithProtection({ auth, code, request, userId });
  if (verificationFailure) {
    return verificationFailure;
  }

  const { accounts } = await getFinanceData();
  const account = accounts.find((candidate) => candidate.id === accountId);

  if (!account) {
    return NextResponse.json({ error: "not_found", message: "Account not found." }, { status: 404 });
  }

  if (!account.id.startsWith("teller_")) {
    return NextResponse.json(
      {
        error: "unsupported_provider",
        message: "Account and routing numbers are currently available for Teller-linked bank accounts only."
      },
      { status: 400 }
    );
  }

  try {
    const details = await getTellerAccountDetails(account.id, account.providerConnectionId);
    return NextResponse.json({
      account_number: details.accountNumber ?? null,
      routing_numbers: details.routingNumbers
    });
  } catch (error) {
    const status = error instanceof TellerSetupError ? 502 : 500;
    const message = error instanceof Error ? error.message : "Teller details request failed.";
    return NextResponse.json({ error: "provider_error", message }, { status });
  }
}

async function verifyTotpWithProtection({
  auth,
  code,
  request,
  userId
}: {
  auth: ReturnType<typeof getBetterAuth>;
  code: string;
  request: Request;
  userId: string;
}): Promise<NextResponse | null> {
  const protectionStateKey = `${totpProtectionStatePrefix}${userId}`;
  return withLockedSyncStateValue(protectionStateKey, async (storedValue) => {
    const protectionState = parseTotpProtectionState(storedValue);
    const lockedUntil = protectionState.lockedUntil ? Date.parse(protectionState.lockedUntil) : Number.NaN;
    if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
      return syncStateResult(protectionState, totpLockedResponse(lockedUntil));
    }
    if (Number.isFinite(lockedUntil)) {
      protectionState.failedAttempts = 0;
      protectionState.lockedUntil = undefined;
    }

    const codeHash = hashTotpCode(code, userId);
    const lastAcceptedAt = protectionState.lastAcceptedAt
      ? Date.parse(protectionState.lastAcceptedAt)
      : Number.NaN;
    if (
      Number.isFinite(lastAcceptedAt) &&
      lastAcceptedAt >= Date.now() - totpReplayWindowMs &&
      equalCodeHashes(protectionState.lastAcceptedCodeHash, codeHash)
    ) {
      return syncStateResult(protectionState, NextResponse.json(
        {
          error: "invalid_totp",
          message: "That code was already used. Wait for a new code and try again."
        },
        { status: 401 }
      ));
    }

    // Step-up: verify the TOTP in-process through better-auth itself, forwarding
    // the caller's session cookies — no bespoke TOTP crypto here.
    const origin = new URL(request.url).origin;
    const verifyResponse = await auth.handler(
      new Request(`${origin}${betterAuthBasePath}/two-factor/verify-totp`, {
        body: JSON.stringify({ code }),
        headers: {
          "content-type": "application/json",
          cookie: request.headers.get("cookie") ?? ""
        },
        method: "POST"
      })
    );

    if (!verifyResponse.ok) {
      const detail = (await verifyResponse.json().catch(() => null)) as { message?: string } | null;
      const notEnrolled = verifyResponse.status === 400 && /two.?factor/i.test(detail?.message ?? "");
      if (!notEnrolled) {
        protectionState.failedAttempts += 1;
        protectionState.lockedUntil = protectionState.failedAttempts >= totpFailureLimit
          ? new Date(Date.now() + totpLockoutMs).toISOString()
          : undefined;

        if (protectionState.lockedUntil) {
          return syncStateResult(protectionState, totpLockedResponse(Date.parse(protectionState.lockedUntil)));
        }
      }

      return syncStateResult(protectionState, NextResponse.json(
        {
          error: notEnrolled ? "two_factor_not_enrolled" : "invalid_totp",
          message: notEnrolled
            ? "Enroll an authenticator app under Settings → Security first."
            : "That code didn't verify. Check your authenticator app and try again."
        },
        { status: 401 }
      ));
    }

    return syncStateResult({
      failedAttempts: 0,
      lastAcceptedAt: new Date(Date.now()).toISOString(),
      lastAcceptedCodeHash: codeHash
    }, null);
  });
}

function syncStateResult(state: TotpProtectionState, result: NextResponse | null) {
  return { result, value: JSON.stringify(state) };
}

function hashTotpCode(code: string, userId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required to protect TOTP replay state.");
  }

  return createHmac("sha256", secret).update(userId).update("\0").update(code).digest("hex");
}

function equalCodeHashes(storedHash: string | undefined, candidateHash: string): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash) || storedHash.length !== candidateHash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(candidateHash, "hex"));
}

function parseTotpProtectionState(value: string | undefined): TotpProtectionState {
  if (!value) {
    return { failedAttempts: 0 };
  }

  try {
    const parsed = JSON.parse(value) as Partial<TotpProtectionState>;
    return {
      failedAttempts: Number.isInteger(parsed.failedAttempts) && Number(parsed.failedAttempts) > 0
        ? Number(parsed.failedAttempts)
        : 0,
      lockedUntil: typeof parsed.lockedUntil === "string" ? parsed.lockedUntil : undefined,
      lastAcceptedAt: typeof parsed.lastAcceptedAt === "string" ? parsed.lastAcceptedAt : undefined,
      lastAcceptedCodeHash:
        typeof parsed.lastAcceptedCodeHash === "string" ? parsed.lastAcceptedCodeHash : undefined
    };
  } catch {
    return { failedAttempts: 0 };
  }
}

function totpLockedResponse(lockedUntil: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: "totp_locked",
      message: "Too many incorrect codes. Try again in 15 minutes."
    },
    {
      headers: { "retry-after": String(retryAfterSeconds) },
      status: 429
    }
  );
}
