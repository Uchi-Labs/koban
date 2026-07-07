import { NextResponse } from "next/server";
import { serializeSimpleFinStatus } from "@/lib/simplefin-api";
import { getSimpleFinSetupStatus } from "@/lib/simplefin-server";

export const runtime = "nodejs";

export async function GET() {
  const status = await getSimpleFinSetupStatus();

  return NextResponse.json({
    object: "simplefin_status",
    ...serializeSimpleFinStatus(status)
  });
}
