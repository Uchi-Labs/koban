// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  runScheduledSync: vi.fn(),
  update: vi.fn()
}));

vi.mock("@/lib/db/finance-db", () => ({
  appSyncScheduleId: "whole_app",
  ensureAppSyncSchedule: mocks.ensure,
  snapTradeSyncScheduleId: "snaptrade",
  updateAppSyncSchedule: mocks.update
}));

vi.mock("@/lib/app-sync-runs", () => ({
  appSyncRunRecordToPayload: (run: { id: string }) => ({ id: run.id, object: "sync_run" }),
  syncScheduleRecordToPayload: (schedule: { due?: boolean; enabled?: boolean; id: string }) => ({
    due: schedule.due ?? true,
    enabled: schedule.enabled ?? true,
    id: schedule.id,
    object: "sync_schedule"
  })
}));

vi.mock("@/lib/sync-schedule-coordinator", () => ({
  runScheduledSync: mocks.runScheduledSync
}));

import { POST } from "@/app/api/v1/sync-schedule/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ensure.mockResolvedValue({ id: "whole_app" });
});

describe("sync schedule route coordinator adapter", () => {
  it("preserves the run response shape", async () => {
    mocks.runScheduledSync.mockResolvedValue({
      run: { id: "app_sync_test" },
      satisfiedSchedules: ["whole_app", "snaptrade"],
      schedule: { id: "whole_app" },
      status: "ran"
    });

    const response = await POST(jsonRequest({ action: "run_due", enrichment_limit: 12 }));

    await expect(response.json()).resolves.toEqual({
      object: "sync_schedule_run",
      run: { id: "app_sync_test", object: "sync_run" },
      schedule: { due: true, enabled: true, id: "whole_app", object: "sync_schedule" },
      status: "ran"
    });
    expect(mocks.runScheduledSync).toHaveBeenCalledWith(expect.objectContaining({
      action: "run_due",
      enrichmentLimit: 12,
      target: "whole_app"
    }));
  });

  it("maps process-local reentry to the existing claimed response", async () => {
    mocks.runScheduledSync.mockResolvedValue({ reason: "busy", status: "skipped" });

    const response = await POST(jsonRequest({ action: "run_now" }));

    await expect(response.json()).resolves.toEqual({
      object: "sync_schedule_run",
      reason: "claimed",
      run: null,
      schedule: { due: true, enabled: true, id: "whole_app", object: "sync_schedule" },
      status: "skipped"
    });
  });

  it("keeps a disabled run_due request skipped before validating unused options", async () => {
    mocks.ensure.mockResolvedValue({ due: false, enabled: false, id: "whole_app" });

    const response = await POST(jsonRequest({ action: "run_due", enrichment_limit: "invalid" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: "disabled", status: "skipped" });
    expect(mocks.runScheduledSync).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/v1/sync-schedule", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
}
