import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { serializePlaidStatus } from "@/lib/plaid-api";
import { exchangePlaidPublicToken } from "@/lib/plaid-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const publicToken = typeof parsed.body.public_token === "string" ? parsed.body.public_token : "";

  if (!publicToken.trim()) {
    return NextResponse.json({ error: "public_token is required." }, { status: 400 });
  }

  try {
    const result = await exchangePlaidPublicToken({
      institutionId: typeof parsed.body.institution_id === "string" ? parsed.body.institution_id : undefined,
      institutionName: typeof parsed.body.institution_name === "string" ? parsed.body.institution_name : undefined,
      publicToken
    });

    return NextResponse.json({
      object: "plaid_item_exchange",
      item: {
        account_count: result.item.accountCount,
        cursor_present: result.item.cursorPresent,
        id: result.item.id,
        institution_id: result.item.institutionId,
        institution_name: result.item.institutionName,
        last_synced_at: result.item.lastSyncedAt,
        status: result.item.status,
        transaction_count: result.item.transactionCount
      },
      status: serializePlaidStatus(result.status)
    });
  } catch (error) {
    return errorResponse(error, "Unable to exchange Plaid public token.");
  }
}
