import { NextResponse } from "next/server";
import { setAccountInclusionOverride, setAccountNameOverride } from "@/lib/account-overlays";
import { serializeAccount } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { accounts } = await getFinanceData();
  const account = accounts.find((candidate) => candidate.id === decodeURIComponent(accountId));

  if (!account) {
    return NextResponse.json({ error: "Account not found in the local ledger." }, { status: 404 });
  }

  return NextResponse.json(serializeAccount(account));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId: rawAccountId } = await params;
  const accountId = decodeURIComponent(rawAccountId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { included_in_net_worth: included, name } = (body as { included_in_net_worth?: unknown; name?: unknown } | null) ?? {};

  if (included === undefined && name === undefined) {
    return NextResponse.json({ error: "Provide included_in_net_worth or name." }, { status: 400 });
  }
  if (included !== undefined && typeof included !== "boolean") {
    return NextResponse.json({ error: "included_in_net_worth must be a boolean." }, { status: 400 });
  }
  if (name !== undefined && name !== null && (typeof name !== "string" || name.trim().length === 0)) {
    return NextResponse.json({ error: "name must be a non-empty string, or null to restore the provider name." }, { status: 400 });
  }

  const { accounts } = await getFinanceData();
  const account = accounts.find((candidate) => candidate.id === accountId);

  if (!account) {
    return NextResponse.json({ error: "Account not found in the local ledger." }, { status: 404 });
  }

  let updated = account;
  if (typeof included === "boolean") {
    await setAccountInclusionOverride(accountId, included);
    updated = { ...updated, includedInNetWorth: included };
  }
  if (name !== undefined) {
    await setAccountNameOverride(accountId, name === null ? null : (name as string).trim());
    if (name === null) {
      // Alias cleared — re-read so the response carries the provider name.
      const { accounts: fresh } = await getFinanceData();
      const providerRow = fresh.find((candidate) => candidate.id === accountId);
      updated = providerRow ? { ...updated, name: providerRow.name } : updated;
    } else {
      updated = { ...updated, name: (name as string).trim() };
    }
  }
  return NextResponse.json(serializeAccount(updated));
}
