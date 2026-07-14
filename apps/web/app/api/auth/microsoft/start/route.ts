import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  createMicrosoftSourceOAuthStart,
  encodeMicrosoftSourceOAuthPendingState,
  isMicrosoftSourceOAuthConfigured,
  microsoftSourceOAuthPendingCookie
} from "@/lib/microsoft-source-oauth";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const env = readWorkspaceEnv();

  if (!isMicrosoftSourceOAuthConfigured(env)) {
    return NextResponse.json(
      { error: "Microsoft Outlook OAuth is not configured for this app." },
      { status: 404 }
    );
  }

  const redirectUri = new URL("/api/auth/microsoft/callback", request.nextUrl.origin).toString();
  const { authorizationUrl, pendingState } = createMicrosoftSourceOAuthStart(redirectUri, env);
  const response = NextResponse.redirect(authorizationUrl);

  response.cookies.set(
    microsoftSourceOAuthPendingCookie,
    encodeMicrosoftSourceOAuthPendingState(pendingState, env),
    {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:"
    }
  );

  return response;
}
