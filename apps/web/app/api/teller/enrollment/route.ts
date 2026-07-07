import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { saveTellerEnrollment, type TellerEnrollmentPayload } from "@/lib/teller-server";

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
    return errorResponse(error, "Unable to save Teller enrollment.");
  }
}
