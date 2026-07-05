import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { saveTellerEnrollment, TellerSetupError, type TellerEnrollmentPayload } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const parsed = await readJsonObject(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const payload = parsed.body as TellerEnrollmentPayload;
    const result = await saveTellerEnrollment(payload, request.cookies.get("teller_connect_nonce")?.value);
    const response = NextResponse.json(result);
    response.cookies.delete("teller_connect_nonce");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save Teller enrollment." },
      { status: error instanceof TellerSetupError ? error.status : 500 }
    );
  }
}
