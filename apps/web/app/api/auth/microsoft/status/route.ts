import { NextResponse } from "next/server";
import {
  clearMicrosoftSourceOAuthTokens,
  microsoftSourceOAuthStatus
} from "@/lib/microsoft-source-oauth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(statusPayload(await microsoftSourceOAuthStatus()));
}

export async function DELETE() {
  await clearMicrosoftSourceOAuthTokens();
  return NextResponse.json(statusPayload(await microsoftSourceOAuthStatus()));
}

function statusPayload(status: Awaited<ReturnType<typeof microsoftSourceOAuthStatus>>) {
  return {
    object: "microsoft_source_oauth_status",
    account_email: status.accountEmail,
    account_name: status.accountName,
    configured: status.configured,
    connected: status.connected,
    expires_at: status.expiresAt
  };
}
