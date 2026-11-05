// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSyncRunRecord } from "@/lib/db/finance-db";

const mocks = vi.hoisted(() => ({
  claimNow: vi.fn(),
  clear: vi.fn(),
  runAppSync: vi.fn(),
  runPlaidSync: vi.fn()
}));

vi.mock("@/lib/db/finance-db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/finance-db")>();
  return {
    ...original,
    claimAppSyncScheduleForRunNow: mocks.claimNow,
    clearAppSyncScheduleClaim: mocks.clear
  };
});

vi.mock("@/lib/app-sync-service", () => ({
  runAppSync: mocks.runAppSync,
  runPlaidSync: mocks.runPlaidSync,
  runSnapTradeSync: vi.fn()
}));

vi.mock("@/lib/sync-schedule-claim", () => ({
  withSyncScheduleClaimHeartbeat: (_id: string, _by: string, operation: (signal: AbortSignal) => Promise<unknown>) =>
    operation(new AbortController().signal)
}));

import { POST as postPlaidSync } from "@/app/api/v1/plaid/sync/route";
import { POST as postSyncRun } from "@/app/api/v1/sync-runs/route";

function post(url: string) {
  return new Request(url, { body: "{}", headers: { "content-type": "application/json" }, method: "POST" });
}

function run(): AppSyncRunRecord {
  const at = "2026-11-05T00:00:00.000Z";
  return {
    enrichmentStatus: "succeeded",
    enrichmentSummary: {},
    finishedAt: at,
    id: "run_1",
    plaidStatus: "succeeded",
    plaidSummary: {},
    simplefinStatus: "succeeded",
    simplefinSummary: {},
    snaptradeStatus: "succeeded",
    snaptradeSummary: {},
    sourcesStatus: "succeeded",
    sourcesSummary: {},
    startedAt: at,
    status: "succeeded"
  };
}

let leaseHolder: string | null = null;

beforeEach(() => {
  leaseHolder = null;
  mocks.claimNow.mockImplementation(async (_scheduleId: string, claimedBy: string) => {
    if (leaseHolder && leaseHolder !== claimedBy) return false;
    leaseHolder = claimedBy;
    return true;
  });
  mocks.clear.mockImplementation(async (_scheduleId: string, claimedBy: string) => {
    if (leaseHolder === claimedBy) leaseHolder = null;
    return true;
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("sync entry points share one lock", () => {
  it("refuses a second whole-app sync while one runs, then accepts the next one", async () => {
    let finish: () => void = () => undefined;
    mocks.runAppSync.mockImplementationOnce(
      () => new Promise<AppSyncRunRecord>((resolve) => {
        finish = () => resolve(run());
      })
    );

    const first = postSyncRun(post("http://localhost/api/v1/sync-runs"));
    await vi.waitFor(() => expect(mocks.runAppSync).toHaveBeenCalledTimes(1));

    const second = await postSyncRun(post("http://localhost/api/v1/sync-runs"));
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: "sync_in_progress" });

    const plaid = await postPlaidSync(post("http://localhost/api/v1/plaid/sync"));
    expect(plaid.status).toBe(409);
    expect(mocks.runPlaidSync).not.toHaveBeenCalled();

    finish();
    expect((await first).status).toBe(200);
    expect(mocks.runAppSync).toHaveBeenCalledTimes(1);
    expect(leaseHolder).toBeNull();

    mocks.runAppSync.mockResolvedValueOnce(run());
    expect((await postSyncRun(post("http://localhost/api/v1/sync-runs"))).status).toBe(200);
  });

  it("refuses a sync while another instance holds the schedule lease", async () => {
    leaseHolder = "sync-schedule-ticker:other-instance";

    const response = await postSyncRun(post("http://localhost/api/v1/sync-runs"));

    expect(response.status).toBe(409);
    expect(mocks.runAppSync).not.toHaveBeenCalled();
    expect(leaseHolder).toBe("sync-schedule-ticker:other-instance");
  });
});
