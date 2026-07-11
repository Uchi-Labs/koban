import { NextResponse } from "next/server";
import { readOptionalJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload, syncScheduleRecordToPayload } from "@/lib/app-sync-runs";
import { runAppSync } from "@/lib/app-sync-service";
import {
  appSyncScheduleId,
  ensureAppSyncSchedule,
  recordAppSyncScheduleRun,
  snapTradeSyncScheduleId,
  updateAppSyncSchedule
} from "@/lib/db/finance-db";
import { parseOptionalEnrichmentLimit, parseOptionalSourceIds } from "@/lib/sync-request";

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

  const schedule = await ensureAppSyncSchedule();
  const schedulePayload = syncScheduleRecordToPayload(schedule);

  if (action === "run_due" && (!schedulePayload.enabled || !schedulePayload.due)) {
    return NextResponse.json({
      object: "sync_schedule_run",
      reason: schedulePayload.enabled ? "not_due" : "disabled",
      run: null,
      schedule: schedulePayload,
      status: "skipped"
    });
  }

  const enrichmentLimit = parseOptionalEnrichmentLimit(body.enrichment_limit);

  if (!enrichmentLimit.ok) {
    return NextResponse.json({ error: enrichmentLimit.error }, { status: 400 });
  }

  const sourceIds = parseOptionalSourceIds(body.source_ids);

  if (!sourceIds.ok) {
    return NextResponse.json({ error: sourceIds.error }, { status: 400 });
  }

  const run = await runAppSync({
    enrichmentLimit: enrichmentLimit.value,
    sourceIds: sourceIds.value
  });
  const updatedSchedule = await recordAppSyncScheduleRun(run);

  return NextResponse.json({
    object: "sync_schedule_run",
    run: appSyncRunRecordToPayload(run),
    schedule: syncScheduleRecordToPayload(updatedSchedule),
    status: "ran"
  });
}
