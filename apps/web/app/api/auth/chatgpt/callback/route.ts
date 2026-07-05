import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  chatGptOAuthPendingCookie,
  exchangeChatGptOAuthCode,
  isChatGptOAuthEnabled,
  isChatGptOAuthPendingStateExpired,
  parseChatGptOAuthPendingState,
  saveChatGptOAuthTokens
} from "@/lib/ai/chatgpt-oauth";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const env = readWorkspaceEnv();

  if (!isChatGptOAuthEnabled(env)) {
    return htmlResponse("ChatGPT OAuth is disabled for this app.", 404);
  }

  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return htmlResponse("ChatGPT sign-in was not completed.", 400);
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const pending = parseChatGptOAuthPendingState(request.cookies.get(chatGptOAuthPendingCookie)?.value);

  if (!code || !state || !pending) {
    return htmlResponse("ChatGPT sign-in callback was missing required state.", 400);
  }

  if (isChatGptOAuthPendingStateExpired(pending) || pending.state !== state) {
    return htmlResponse("ChatGPT sign-in state expired or did not match.", 400);
  }

  try {
    const tokens = await exchangeChatGptOAuthCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri
    });
    await saveChatGptOAuthTokens(tokens);
    const response = htmlResponse("ChatGPT sign-in is complete. Return to Settings.", 200);
    response.cookies.delete(chatGptOAuthPendingCookie);
    return response;
  } catch {
    return htmlResponse("ChatGPT sign-in failed during token exchange.", 502);
  }
}

function htmlResponse(message: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ChatGPT OAuth</title></head><body><main><h1>${escapeHtml(
      message
    )}</h1><p>You can close this tab.</p></main></body></html>`,
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
