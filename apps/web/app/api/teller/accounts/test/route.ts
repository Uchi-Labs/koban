import { NextResponse } from "next/server";
import { TellerSetupError, testTellerAccounts } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await testTellerAccounts());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to test Teller account access." },
      { status: error instanceof TellerSetupError ? error.status : 500 }
    );
  }
}
