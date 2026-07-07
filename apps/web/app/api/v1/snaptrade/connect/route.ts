import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readOptionalJsonObject } from "@/lib/api-request";
import { serializeSnapTradeStatus } from "@/lib/snaptrade-api";
import { createSnapTradeConnectionPortal } from "@/lib/snaptrade-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const portal = await createSnapTradeConnectionPortal();

    return NextResponse.json({
      object: "snaptrade_connection_portal",
      expires_in_seconds: portal.expiresInSeconds,
      redirect_uri: portal.redirectUri,
      session_id: portal.sessionId,
      status: serializeSnapTradeStatus(portal.status)
    });
  } catch (error) {
    return errorResponse(error, "Unable to create SnapTrade connection portal.");
  }
}
