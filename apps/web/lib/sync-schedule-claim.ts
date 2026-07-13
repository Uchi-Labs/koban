import {
  refreshAppSyncScheduleClaim,
  type SyncScheduleId
} from "@/lib/db/finance-db";

const claimHeartbeatIntervalMs = 5 * 60 * 1000;

/** Keeps a live schedule lease younger than the 15-minute stale-claim window. */
export async function withSyncScheduleClaimHeartbeat<T>(
  scheduleId: SyncScheduleId,
  claimedBy: string,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let rejectOwnershipLoss: (error: Error) => void = () => {};
  const ownershipLost = new Promise<never>((_resolve, reject) => {
    rejectOwnershipLoss = reject;
  });
  const loseOwnership = (error: unknown) => {
    if (controller.signal.aborted) {
      return;
    }
    const reason = error instanceof Error ? error : new Error("Sync schedule claim was lost.");
    controller.abort(reason);
    rejectOwnershipLoss(reason);
  };
  const timer = setInterval(() => {
    void refreshAppSyncScheduleClaim(scheduleId, claimedBy).then((refreshed) => {
      if (!refreshed) {
        loseOwnership(new Error(`Sync schedule ${scheduleId} claim was lost.`));
      }
    }, loseOwnership);
  }, claimHeartbeatIntervalMs);
  timer.unref?.();

  try {
    return await Promise.race([operation(controller.signal), ownershipLost]);
  } finally {
    clearInterval(timer);
  }
}
