// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appSyncScheduleId,
  snapTradeSyncScheduleId,
  type AppSyncRunRecord,
  type SyncScheduleId,
  type SyncScheduleRecord
} from "@/lib/db/finance-db";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  claimNow: vi.fn(),
  clear: vi.fn(),
  ensure: vi.fn(),
  heartbeat: vi.fn(),
  record: vi.fn(),
  runSnapTrade: vi.fn(),
  runWholeApp: vi.fn()
}));

vi.mock("@/lib/db/finance-db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/finance-db")>();
  return {
    ...original,
    claimAppSyncSchedule: mocks.claim,
    claimAppSyncScheduleForRunNow: mocks.claimNow,
    clearAppSyncScheduleClaim: mocks.clear,
    ensureAppSyncSchedule: mocks.ensure,
    recordAppSyncScheduleRun: mocks.record
  };
});

vi.mock("@/lib/app-sync-service", () => ({
  runAppSync: mocks.runWholeApp,
  runSnapTradeSync: mocks.runSnapTrade
}));

vi.mock("@/lib/sync-schedule-claim", () => ({
  withSyncScheduleClaimHeartbeat: mocks.heartbeat
}));

import { runScheduledSync } from "@/lib/sync-schedule-coordinator";

const now = Date.parse("2026-05-31T02:00:00.000Z");

beforeEach(() => {
  mocks.ensure.mockImplementation(async (scheduleId: SyncScheduleId) => schedule(scheduleId, true));
  mocks.claim.mockResolvedValue(true);
  mocks.claimNow.mockResolvedValue(true);
  mocks.clear.mockResolvedValue(true);
  mocks.record.mockImplementation(async (_run: AppSyncRunRecord, scheduleId: SyncScheduleId) => schedule(scheduleId, false));
  mocks.heartbeat.mockImplementation(
    async (_scheduleId: SyncScheduleId, _claimedBy: string, operation: (signal: AbortSignal) => Promise<unknown>) =>
      operation(new AbortController().signal)
  );
  mocks.runWholeApp.mockResolvedValue(syncRun({ status: "succeeded", snaptradeStatus: "succeeded" }));
  mocks.runSnapTrade.mockResolvedValue({
    run: syncRun({ status: "succeeded", snaptradeStatus: "succeeded" }),
    snaptrade: { ok: true }
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("scheduled sync coordination", () => {
  it("claims whole-app first and satisfies both due schedules with one provider run", async () => {
    const run = syncRun({ status: "partial", snaptradeStatus: "succeeded" });
    mocks.runWholeApp.mockResolvedValue(run);

    const result = await runScheduledSync(request());

    expect(result).toMatchObject({
      satisfiedSchedules: [appSyncScheduleId, snapTradeSyncScheduleId],
      status: "ran"
    });
    expect(mocks.claim.mock.calls.map(([scheduleId]) => scheduleId)).toEqual([
      appSyncScheduleId,
      snapTradeSyncScheduleId
    ]);
    expect(mocks.runWholeApp).toHaveBeenCalledOnce();
    expect(mocks.runWholeApp).toHaveBeenCalledWith(expect.objectContaining({ includeSnapTrade: true }));
    expect(mocks.runSnapTrade).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenNthCalledWith(1, run, appSyncScheduleId, "test-runner");
    expect(mocks.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: run.id, status: "succeeded" }),
      snapTradeSyncScheduleId,
      "test-runner"
    );
  });

  it("runs only the due SnapTrade schedule", async () => {
    mocks.ensure.mockImplementation(async (scheduleId: SyncScheduleId) =>
      schedule(scheduleId, scheduleId === snapTradeSyncScheduleId)
    );

    const result = await runScheduledSync(request());

    expect(result).toMatchObject({ satisfiedSchedules: [snapTradeSyncScheduleId], status: "ran" });
    expect(mocks.runSnapTrade).toHaveBeenCalledOnce();
    expect(mocks.runWholeApp).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledOnce();
  });

  it("runs only the due whole-app schedule", async () => {
    mocks.ensure.mockImplementation(async (scheduleId: SyncScheduleId) =>
      schedule(scheduleId, scheduleId === appSyncScheduleId)
    );

    const result = await runScheduledSync(request());

    expect(result).toMatchObject({ satisfiedSchedules: [appSyncScheduleId], status: "ran" });
    expect(mocks.claimNow).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
    expect(mocks.runWholeApp).toHaveBeenCalledWith(expect.objectContaining({ includeSnapTrade: true }));
    expect(mocks.runSnapTrade).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.clear).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
  });

  it("preserves forced whole-app run-now when neither schedule is due", async () => {
    mocks.ensure.mockImplementation(async (scheduleId: SyncScheduleId) => schedule(scheduleId, false));

    const result = await runScheduledSync({ ...request(), action: "run_now", target: "whole_app" });

    expect(result).toMatchObject({ satisfiedSchedules: [appSyncScheduleId], status: "ran" });
    expect(mocks.claimNow).toHaveBeenCalledWith(appSyncScheduleId, "test-runner");
    expect(mocks.claimNow).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
    expect(mocks.runWholeApp).toHaveBeenCalledWith(expect.objectContaining({ includeSnapTrade: true }));
  });

  it("excludes SnapTrade when another runner acquires its not-due lease before whole-app starts", async () => {
    mocks.ensure.mockImplementation(async (scheduleId: SyncScheduleId) =>
      schedule(scheduleId, scheduleId === appSyncScheduleId)
    );
    mocks.claimNow.mockResolvedValue(false);

    const result = await runScheduledSync(request());

    expect(result).toMatchObject({ satisfiedSchedules: [appSyncScheduleId], status: "ran" });
    expect(mocks.claimNow).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
    expect(mocks.runWholeApp).toHaveBeenCalledWith(expect.objectContaining({ includeSnapTrade: false }));
    expect(mocks.clear).not.toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
  });

  it("starts the whole-app heartbeat before waiting for the secondary lease", async () => {
    mocks.ensure.mockImplementation(async (scheduleId: SyncScheduleId) =>
      schedule(scheduleId, scheduleId === appSyncScheduleId)
    );
    let finishSecondaryClaim: ((claimed: boolean) => void) | undefined;
    mocks.claimNow.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishSecondaryClaim = resolve;
    }));

    const result = runScheduledSync(request());
    await vi.waitFor(() => {
      expect(mocks.heartbeat).toHaveBeenCalledWith(
        appSyncScheduleId,
        "test-runner",
        expect.any(Function)
      );
      expect(mocks.claimNow).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
    });
    expect(mocks.runWholeApp).not.toHaveBeenCalled();

    finishSecondaryClaim?.(true);
    await expect(result).resolves.toMatchObject({ status: "ran" });
    expect(mocks.runWholeApp).toHaveBeenCalledOnce();
  });

  it("does not run SnapTrade when another runner owns the due whole-app schedule", async () => {
    mocks.claim.mockResolvedValueOnce(false);

    await expect(runScheduledSync(request())).resolves.toEqual({ reason: "claimed", status: "skipped" });
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.runWholeApp).not.toHaveBeenCalled();
    expect(mocks.runSnapTrade).not.toHaveBeenCalled();
  });

  it("skips SnapTrade inside whole-app when its due schedule is claimed elsewhere", async () => {
    mocks.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await runScheduledSync(request());

    expect(result).toMatchObject({ satisfiedSchedules: [appSyncScheduleId], status: "ran" });
    expect(mocks.runWholeApp).toHaveBeenCalledWith(expect.objectContaining({ includeSnapTrade: false }));
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.clear).not.toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
  });

  it("leaves SnapTrade due when its step is partial", async () => {
    mocks.runWholeApp.mockResolvedValue(syncRun({ status: "partial", snaptradeStatus: "partial" }));

    const result = await runScheduledSync(request());

    expect(result).toMatchObject({ satisfiedSchedules: [appSyncScheduleId], status: "ran" });
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.clear).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
  });

  it("leaves SnapTrade due when the whole-app run skipped an unconfigured provider", async () => {
    mocks.runWholeApp.mockResolvedValue(syncRun({
      snaptradeStatus: "succeeded",
      snaptradeSummary: { configured: false, skipped: true }
    }));

    const result = await runScheduledSync(request());

    expect(result).toMatchObject({ satisfiedSchedules: [appSyncScheduleId], status: "ran" });
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.clear).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
  });

  it("clears both claims when the whole-app run fails", async () => {
    mocks.runWholeApp.mockRejectedValue(new Error("sync failed"));
    mocks.clear.mockRejectedValue(new Error("cleanup failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runScheduledSync(request())).rejects.toThrow("sync failed");
    expect(mocks.clear).toHaveBeenCalledWith(appSyncScheduleId, "test-runner");
    expect(mocks.clear).toHaveBeenCalledWith(snapTradeSyncScheduleId, "test-runner");
    expect(consoleError).toHaveBeenCalledWith(
      "[sync-schedule] failed to release claim",
      { scheduleId: appSyncScheduleId }
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[sync-schedule] failed to release claim",
      { scheduleId: snapTradeSyncScheduleId }
    );
  });

  it("rejects reentry while running and accepts the next tick after cleanup", async () => {
    let finishRun: ((run: AppSyncRunRecord) => void) | undefined;
    mocks.runWholeApp.mockImplementationOnce(() => new Promise<AppSyncRunRecord>((resolve) => {
      finishRun = resolve;
    }));

    const first = runScheduledSync(request());
    await vi.waitFor(() => expect(mocks.runWholeApp).toHaveBeenCalledOnce());
    await expect(runScheduledSync(request())).resolves.toEqual({ reason: "busy", status: "skipped" });

    finishRun?.(syncRun({ status: "succeeded", snaptradeStatus: "succeeded" }));
    await first;
    await expect(runScheduledSync(request())).resolves.toMatchObject({ status: "ran" });
    expect(mocks.runWholeApp).toHaveBeenCalledTimes(2);
  });
});

function request() {
  return {
    action: "run_due" as const,
    claimedBy: "test-runner",
    now,
    target: "all_due" as const
  };
}

function schedule(id: SyncScheduleId, due: boolean): SyncScheduleRecord {
  return {
    createdAt: "2026-05-31T00:00:00.000Z",
    enabled: true,
    id,
    intervalMinutes: id === appSyncScheduleId ? 240 : 30,
    nextRunAt: due ? "2026-05-31T01:00:00.000Z" : "2026-05-31T03:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z"
  };
}

function syncRun(overrides: Partial<AppSyncRunRecord>): AppSyncRunRecord {
  return {
    enrichmentStatus: "succeeded",
    enrichmentSummary: {},
    finishedAt: "2026-05-31T02:01:00.000Z",
    id: "app_sync_test",
    plaidStatus: "succeeded",
    plaidSummary: {},
    simplefinStatus: "succeeded",
    simplefinSummary: {},
    snaptradeStatus: "succeeded",
    snaptradeSummary: {},
    sourcesStatus: "succeeded",
    sourcesSummary: {},
    startedAt: "2026-05-31T02:00:00.000Z",
    status: "succeeded",
    ...overrides
  };
}
