import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { errorResponse, syncInProgressResponse } from "@/lib/api-error";
import { readOptionalJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload } from "@/lib/app-sync-runs";
import { runSnapTradeSync } from "@/lib/app-sync-service";
import { appSyncScheduleId, snapTradeSyncScheduleId } from "@/lib/db/finance-db";
import { runExclusiveSync } from "@/lib/sync-schedule-coordinator";
import { serializeSnapTradeStatus } from "@/lib/snaptrade-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await runExclusiveSync(
      { claimedBy: `snaptrade-sync-api:${process.pid}:${randomUUID()}`, scheduleIds: [appSyncScheduleId, snapTradeSyncScheduleId] },
      (signal) => runSnapTradeSync(signal)
    );

    if (result.status === "skipped") {
      return syncInProgressResponse();
    }

    const { run, snaptrade } = result.value;

    return NextResponse.json({
      object: "snaptrade_sync_run",
      account_count: snaptrade.accountCount,
      app_sync_run: appSyncRunRecordToPayload(run),
      connection_count: snaptrade.connectionCount,
      errors: snaptrade.errors,
      last_synced_at: snaptrade.lastSyncedAt,
      ok: snaptrade.ok,
      position_count: snaptrade.positionCount,
      status: serializeSnapTradeStatus(snaptrade.status)
    });
  } catch (error) {
    return errorResponse(error, "Unable to sync SnapTrade data.");
  }
}
