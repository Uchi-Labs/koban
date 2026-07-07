import { NextResponse } from "next/server";
import { serializeSnapTradeStatus } from "@/lib/snaptrade-api";
import { getSnapTradeSetupStatus } from "@/lib/snaptrade-server";

export const runtime = "nodejs";

export async function GET() {
  const status = await getSnapTradeSetupStatus();

  return NextResponse.json({
    object: "snaptrade_status",
    ...serializeSnapTradeStatus(status)
  });
}
