import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { syncTellerData } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await syncTellerData());
  } catch (error) {
    return errorResponse(error, "Unable to sync Teller data.");
  }
}
