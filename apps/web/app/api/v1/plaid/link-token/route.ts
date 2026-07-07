import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readOptionalJsonObject } from "@/lib/api-request";
import { createPlaidLinkToken } from "@/lib/plaid-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await createPlaidLinkToken();

    return NextResponse.json({
      object: "plaid_link_token",
      expiration: result.expiration,
      link_token: result.linkToken,
      request_id: result.requestId
    });
  } catch (error) {
    return errorResponse(error, "Unable to create Plaid Link token.");
  }
}
