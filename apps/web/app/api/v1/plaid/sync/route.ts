import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readOptionalJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload } from "@/lib/app-sync-runs";
import { runPlaidSync } from "@/lib/app-sync-service";
import { serializePlaidStatus } from "@/lib/plaid-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { run, plaid } = await runPlaidSync();

    return NextResponse.json({
      object: "plaid_sync_run",
      account_count: plaid.accountCount,
      app_sync_run: appSyncRunRecordToPayload(run),
      errors: plaid.errors,
      item_count: plaid.itemCount,
      last_synced_at: plaid.lastSyncedAt,
      ok: plaid.ok,
      removed_transaction_count: plaid.removedTransactionCount,
      status: serializePlaidStatus(plaid.status),
      transaction_count: plaid.transactionCount
    });
  } catch (error) {
    return errorResponse(error, "Unable to sync Plaid data.");
  }
}
