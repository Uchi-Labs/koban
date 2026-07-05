import { NextResponse } from "next/server";
import { chatGptOAuthStatus, clearChatGptOAuthTokens } from "@/lib/ai/chatgpt-oauth";
import { getLlmEnrichmentStatus } from "@/lib/llm-enrichment";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

export async function GET() {
  const env = readWorkspaceEnv();
  const provider = getLlmEnrichmentStatus(env);
  const status = chatGptOAuthStatus(env);

  return NextResponse.json({
    object: "chatgpt_oauth_status",
    active_credential_source: provider.credentialSource,
    connected: status.connected,
    enabled: status.enabled,
    expires_at: status.expiresAt
  });
}

export async function DELETE() {
  await clearChatGptOAuthTokens();
  const env = readWorkspaceEnv();
  const provider = getLlmEnrichmentStatus(env);
  const status = chatGptOAuthStatus(env);

  return NextResponse.json({
    object: "chatgpt_oauth_status",
    active_credential_source: provider.credentialSource,
    connected: status.connected,
    enabled: status.enabled,
    expires_at: status.expiresAt
  });
}
