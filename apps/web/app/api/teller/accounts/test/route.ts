import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { testTellerAccounts } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await testTellerAccounts());
  } catch (error) {
    return errorResponse(error, "Unable to test Teller account access.");
  }
}
