import { NextResponse } from "next/server";
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
