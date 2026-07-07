import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { createTellerConnectConfig, getTellerSetupStatus } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = createTellerConnectConfig();
    const response = NextResponse.json({
      ...config,
      status: await getTellerSetupStatus()
    });

    response.cookies.set("teller_connect_nonce", config.nonce, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: false
    });

    return response;
  } catch (error) {
    return errorResponse(error, "Unable to prepare Teller Connect.");
  }
}
