import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  attachMicrosoftSourceAccount,
  exchangeMicrosoftSourceOAuthCode,
  isMicrosoftSourceOAuthConfigured,
  isMicrosoftSourceOAuthPendingStateExpired,
  microsoftSourceOAuthPendingCookie,
  parseMicrosoftSourceOAuthPendingState,
  saveMicrosoftSourceOAuthTokens
} from "@/lib/microsoft-source-oauth";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const env = readWorkspaceEnv();

  if (!isMicrosoftSourceOAuthConfigured(env)) {
    return htmlResponse("Microsoft Outlook OAuth is not configured for this app.", 404);
  }

  if (request.nextUrl.searchParams.has("error")) {
    return htmlResponse("Microsoft sign-in was not completed.", 400);
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const pending = parseMicrosoftSourceOAuthPendingState(
    request.cookies.get(microsoftSourceOAuthPendingCookie)?.value,
    env
  );

  if (!code || !state || !pending) {
    return htmlResponse("Microsoft sign-in callback was missing required state.", 400);
  }

  if (isMicrosoftSourceOAuthPendingStateExpired(pending) || pending.state !== state) {
    return htmlResponse("Microsoft sign-in state expired or did not match.", 400);
  }

  try {
    const exchanged = await exchangeMicrosoftSourceOAuthCode({
      code,
      codeVerifier: pending.codeVerifier,
      env,
      redirectUri: pending.redirectUri
    });
    const tokens = await attachMicrosoftSourceAccount(exchanged);
    await saveMicrosoftSourceOAuthTokens(tokens, env);
    const destination = new URL("/settings", request.nextUrl.origin);
    destination.searchParams.set("microsoft", "connected");
    const response = NextResponse.redirect(destination);
    response.cookies.delete(microsoftSourceOAuthPendingCookie);
    return response;
  } catch {
    return htmlResponse("Microsoft sign-in failed while the app exchanged or verified credentials.", 502);
  }
}

function htmlResponse(message: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Microsoft Outlook connection</title></head><body><main><h1>${escapeHtml(
      message
    )}</h1><p>Return to Settings and try again.</p></main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8"
      },
      status
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
