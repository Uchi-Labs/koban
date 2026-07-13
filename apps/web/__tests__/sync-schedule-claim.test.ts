// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshAppSyncScheduleClaim: vi.fn()
}));

vi.mock("@/lib/db/finance-db", () => ({
  refreshAppSyncScheduleClaim: mocks.refreshAppSyncScheduleClaim
}));

import { withSyncScheduleClaimHeartbeat } from "@/lib/sync-schedule-claim";

describe("sync schedule claim heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("aborts the operation when the runner loses its claim", async () => {
    vi.useFakeTimers();
    mocks.refreshAppSyncScheduleClaim.mockResolvedValue(false);
    let operationSignal: AbortSignal | undefined;

    const result = withSyncScheduleClaimHeartbeat("whole_app", "runner-a", async (signal) => {
      operationSignal = signal;
      return await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const rejection = expect(result).rejects.toThrow("claim was lost");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await rejection;
    expect(operationSignal?.aborted).toBe(true);
    expect(mocks.refreshAppSyncScheduleClaim).toHaveBeenCalledWith("whole_app", "runner-a");
  });
});
