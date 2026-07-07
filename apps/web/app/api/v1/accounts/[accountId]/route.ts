import { NextResponse } from "next/server";
import { setAccountInclusionOverride } from "@/lib/account-overlays";
import { serializeAccount } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const { accounts } = await getFinanceData();
  const account = accounts.find((candidate) => candidate.id === decodeURIComponent(accountId));

  if (!account) {
    return NextResponse.json({ error: "Account not found in the local Teller ledger." }, { status: 404 });
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

  const included = (body as { included_in_net_worth?: unknown } | null)?.included_in_net_worth;
  if (typeof included !== "boolean") {
    return NextResponse.json({ error: "included_in_net_worth must be a boolean." }, { status: 400 });
  }

  const { accounts } = await getFinanceData();
  const account = accounts.find((candidate) => candidate.id === accountId);

  if (!account) {
    return NextResponse.json({ error: "Account not found in the local Teller ledger." }, { status: 404 });
  }

  await setAccountInclusionOverride(accountId, included);
  return NextResponse.json(serializeAccount({ ...account, includedInNetWorth: included }));
}
