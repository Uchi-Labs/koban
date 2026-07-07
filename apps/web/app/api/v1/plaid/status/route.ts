import { NextResponse } from "next/server";
import { serializePlaidStatus } from "@/lib/plaid-api";
import { getPlaidSetupStatus } from "@/lib/plaid-server";

export const runtime = "nodejs";

export async function GET() {
  const status = await getPlaidSetupStatus();

  return NextResponse.json({
    object: "plaid_status",
    ...serializePlaidStatus(status)
  });
}
