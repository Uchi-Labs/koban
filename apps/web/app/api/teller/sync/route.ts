import { NextResponse } from "next/server";
import { syncTellerData, TellerSetupError } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await syncTellerData());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync Teller data." },
      { status: error instanceof TellerSetupError ? error.status : 500 }
    );
  }
}
