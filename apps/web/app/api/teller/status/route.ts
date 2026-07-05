import { NextResponse } from "next/server";
import { getTellerSetupStatus } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getTellerSetupStatus());
}
