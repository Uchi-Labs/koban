import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  chatGptOAuthPendingCookie,
  createChatGptOAuthStart,
  encodeChatGptOAuthPendingState,
  isChatGptOAuthEnabled
} from "@/lib/ai/chatgpt-oauth";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const env = readWorkspaceEnv();

  if (!isChatGptOAuthEnabled(env)) {
    return NextResponse.json(
      { error: "ChatGPT OAuth is disabled. Set AI_FINANCES_ENABLE_CHATGPT_OAUTH=1 to enable it." },
      { status: 404 }
    );
  }

  const redirectUri = new URL("/api/auth/chatgpt/callback", request.nextUrl.origin).toString();
  const { authorizationUrl, pendingState } = createChatGptOAuthStart(redirectUri);
  const response = NextResponse.json({
    object: "chatgpt_oauth_start",
    authorization_url: authorizationUrl
  });

  response.cookies.set(chatGptOAuthPendingCookie, encodeChatGptOAuthPendingState(pendingState), {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:"
  });

  return response;
}
