import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { errorResponse, syncInProgressResponse } from "@/lib/api-error";
import { readOptionalJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload } from "@/lib/app-sync-runs";
import { runSimpleFinSync } from "@/lib/app-sync-service";
import { appSyncScheduleId } from "@/lib/db/finance-db";
import { runExclusiveSync } from "@/lib/sync-schedule-coordinator";
import { serializeSimpleFinStatus } from "@/lib/simplefin-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await runExclusiveSync(
      { claimedBy: `simplefin-sync-api:${process.pid}:${randomUUID()}`, scheduleIds: [appSyncScheduleId] },
      () => runSimpleFinSync()
    );

    if (result.status === "skipped") {
      return syncInProgressResponse();
    }

    const { run, simplefin } = result.value;

    return NextResponse.json({
      object: "simplefin_sync_run",
      account_count: simplefin.accountCount,
      app_sync_run: appSyncRunRecordToPayload(run),
      connection_count: simplefin.connectionCount,
      errors: simplefin.errors,
      last_synced_at: simplefin.lastSyncedAt,
      newest_posted_at: simplefin.newestPostedAt,
      ok: simplefin.ok,
      request_end_unix: simplefin.requestEndUnix,
      request_start_unix: simplefin.requestStartUnix,
      status: serializeSimpleFinStatus(simplefin.status),
      transaction_count: simplefin.transactionCount
    });
  } catch (error) {
    return errorResponse(error, "Unable to sync SimpleFIN data.");
  }
}
