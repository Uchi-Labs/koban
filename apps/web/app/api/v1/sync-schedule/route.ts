import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readOptionalJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload, syncScheduleRecordToPayload } from "@/lib/app-sync-runs";
import {
  appSyncScheduleId,
  ensureAppSyncSchedule,
  snapTradeSyncScheduleId,
  updateAppSyncSchedule
} from "@/lib/db/finance-db";
import { parseOptionalEnrichmentLimit, parseOptionalSourceIds } from "@/lib/sync-request";
import { runScheduledSync } from "@/lib/sync-schedule-coordinator";

export const runtime = "nodejs";

export async function GET() {
  const [schedule, snaptrade] = await Promise.all([
    ensureAppSyncSchedule(),
    ensureAppSyncSchedule(snapTradeSyncScheduleId)
  ]);

  return NextResponse.json({
    ...syncScheduleRecordToPayload(schedule),
    snaptrade: syncScheduleRecordToPayload(snaptrade)
  });
}

export async function PATCH(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as {
    enabled?: unknown;
    interval_minutes?: unknown;
    schedule_id?: unknown;
  };
  const scheduleId = body.schedule_id === snapTradeSyncScheduleId ? snapTradeSyncScheduleId : appSyncScheduleId;
  const schedule = await updateAppSyncSchedule(
    {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      intervalMinutes: typeof body.interval_minutes === "number" ? body.interval_minutes : undefined
    },
    scheduleId
  );

  return NextResponse.json(syncScheduleRecordToPayload(schedule));
}

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as {
    action?: unknown;
    enrichment_limit?: unknown;
    source_ids?: unknown;
  };
  const action = typeof body.action === "string" ? body.action : "run_due";

  if (action !== "run_due" && action !== "run_now") {
    return NextResponse.json({ error: "Unsupported sync schedule action." }, { status: 400 });
  }

  // Preserve the route's cheap run_due response before validating options that
  // will never be used. The coordinator repeats the check at claim time, where
  // it remains authoritative if the schedule changes between these reads.
  if (action === "run_due") {
    const schedulePayload = syncScheduleRecordToPayload(await ensureAppSyncSchedule());
    if (!schedulePayload.enabled || !schedulePayload.due) {
      return NextResponse.json({
        object: "sync_schedule_run",
        reason: schedulePayload.enabled ? "not_due" : "disabled",
        run: null,
        schedule: schedulePayload,
        status: "skipped"
      });
    }
  }

  const enrichmentLimit = parseOptionalEnrichmentLimit(body.enrichment_limit);

  if (!enrichmentLimit.ok) {
    return NextResponse.json({ error: enrichmentLimit.error }, { status: 400 });
  }

  const sourceIds = parseOptionalSourceIds(body.source_ids);

  if (!sourceIds.ok) {
    return NextResponse.json({ error: sourceIds.error }, { status: 400 });
  }

  const claimedBy = `sync-schedule-api:${process.pid}:${randomUUID()}`;
  const result = await runScheduledSync({
    action,
    claimedBy,
    enrichmentLimit: enrichmentLimit.value,
    sourceIds: sourceIds.value,
    target: "whole_app"
  });

  if (result.status === "skipped") {
    return NextResponse.json({
      object: "sync_schedule_run",
      reason: result.reason === "busy" ? "claimed" : result.reason,
      run: null,
      schedule: syncScheduleRecordToPayload(await ensureAppSyncSchedule()),
      status: "skipped"
    });
  }

  return NextResponse.json({
    object: "sync_schedule_run",
    run: appSyncRunRecordToPayload(result.run),
    schedule: syncScheduleRecordToPayload(result.schedule),
    status: "ran"
  });
}
