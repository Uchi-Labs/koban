import { NextResponse } from "next/server";
import { createTellerConnectConfig, getTellerSetupStatus, TellerSetupError } from "@/lib/teller-server";

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
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to prepare Teller Connect.",
        status: await getTellerSetupStatus()
      },
      { status: error instanceof TellerSetupError ? error.status : 500 }
    );
  }
}
