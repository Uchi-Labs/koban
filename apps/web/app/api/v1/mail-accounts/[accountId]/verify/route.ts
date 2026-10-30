import { NextResponse } from "next/server";
import { getMailAccount, readIcloudCredentials } from "@/lib/mail-accounts";
import { fetchIcloudSourceItems } from "@/lib/icloud-source";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const account = await getMailAccount(accountId);
  const headers = { "cache-control": "no-store" };
  if (!account) return NextResponse.json({ error: "Mail account not found." }, { status: 404, headers });
  if (account.provider !== "icloud") return NextResponse.json({ configured: true, live_access: "not_checked" }, { headers });
  try { await readIcloudCredentials(account.id); }
  catch { return NextResponse.json({ configured: false, live_access: "not_checked" }, { headers }); }
  try {
    await fetchIcloudSourceItems(account, { maxMessages: 1, signal: request.signal });
    return NextResponse.json({ configured: true, live_access: "verified" }, { headers });
  } catch {
    return NextResponse.json({ configured: true, live_access: "failed", error: "iCloud Mail access failed. Check the app-specific password and connection." }, { headers });
  }
}
