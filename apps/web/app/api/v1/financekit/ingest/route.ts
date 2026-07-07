import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload } from "@/lib/app-sync-runs";
import { authenticateApiRequest } from "@/lib/auth";
import { getLatestAppSyncRun } from "@/lib/db/finance-db";
import {
  ingestFinanceKitPayload,
  parseFinanceKitIngestBody
} from "@/lib/financekit-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);

  if (!auth.authenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const input = parseFinanceKitIngestBody(parsed.body);

  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  try {
    const result = await ingestFinanceKitPayload(input.value);
    const appSyncRun = await getLatestAppSyncRun();

    return NextResponse.json({
      object: "financekit_ingest",
      accounts_upserted: result.accountsUpserted,
      app_sync_run: appSyncRun ? appSyncRunRecordToPayload(appSyncRun) : null,
      app_sync_run_id: result.appSyncRunId,
      last_ingested_at: result.lastIngestedAt,
      transactions_added: result.transactionsAdded,
      transactions_unchanged: result.transactionsUnchanged,
      transactions_updated: result.transactionsUpdated
    });
  } catch (error) {
    return errorResponse(error, "Unable to ingest FinanceKit data.");
  }
}
