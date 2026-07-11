import { NextResponse } from "next/server";
import { betterAuthBasePath, getBetterAuth, isHostedAuthMode } from "@/lib/auth";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { getFinanceData } from "@/lib/finance-data";
import { getTellerAccountDetails, TellerSetupError } from "@/lib/teller-server";

export const runtime = "nodejs";

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

  // Step-up: verify the TOTP in-process through better-auth itself, forwarding
  // the caller's session cookies — no bespoke TOTP crypto here.
  const origin = new URL(request.url).origin;
  const verifyResponse = await getBetterAuth().handler(
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
    return NextResponse.json(
      {
        error: notEnrolled ? "two_factor_not_enrolled" : "invalid_totp",
        message: notEnrolled
          ? "Enroll an authenticator app under Settings → Security first."
          : "That code didn't verify. Check your authenticator app and try again."
      },
      { status: 401 }
    );
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
