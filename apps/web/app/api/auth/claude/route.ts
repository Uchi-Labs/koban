import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  ClaudeCredentialError,
  claudeConnectionState,
  clearClaudeOAuthTokens,
  finishClaudeOAuthLogin,
  saveClaudeSetupToken,
  startClaudeOAuthLogin
} from "@/lib/ai/claude-oauth";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

async function statusResponse() {
  const state = await claudeConnectionState(readWorkspaceEnv());

  return NextResponse.json({
    object: "claude_subscription_status",
    connected: state.connected,
    error_message: state.errorMessage,
    expires_at: state.expiresAt,
    source: state.source
  });
}

export async function GET() {
  return statusResponse();
}

/**
 * Connects the Claude subscription. Body is one of:
 * - `{ action: "setup_token", token }`: a token from `claude setup-token`.
 * - `{ action: "start" }`: returns the claude.ai URL that shows a code.
 * - `{ action: "finish", code }`: the `code#state` string that page showed.
 */
export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { body } = parsed;

  try {
    if (body.action === "setup_token") {
      if (typeof body.token !== "string" || !body.token.trim()) {
        return NextResponse.json({ error: "token must be a non-empty string." }, { status: 400 });
      }

      await saveClaudeSetupToken(body.token);
      return statusResponse();
    }

    if (body.action === "start") {
      const { url } = await startClaudeOAuthLogin();
      return NextResponse.json({ object: "claude_oauth_start", url });
    }

    if (body.action === "finish") {
      if (typeof body.code !== "string" || !body.code.trim()) {
        return NextResponse.json({ error: "code must be a non-empty string." }, { status: 400 });
      }

      await finishClaudeOAuthLogin(body.code);
      return statusResponse();
    }
  } catch (error) {
    if (error instanceof ClaudeCredentialError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }

  return NextResponse.json({ error: "action must be setup_token, start or finish." }, { status: 400 });
}

/** Removes the token stored here. A borrowed Claude Code login is left alone. */
export async function DELETE() {
  await clearClaudeOAuthTokens();
  return statusResponse();
}
