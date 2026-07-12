export type SyncIslandStatus = "idle" | "syncing" | "success" | "error";

export interface SyncIslandStateInput {
  status: SyncIslandStatus;
  source: "empty" | "teller";
  lastSyncedAt?: string;
  accountCount: number;
  transactionCount: number;
  phaseIndex?: number;
}

export interface SyncIslandState {
  view: "syncing" | "success" | "error" | null;
  compactLabel: string;
  detail: string;
  phaseLabel: string;
  tone: "idle" | "syncing" | "success" | "error";
}

// Server stages a single sync-run runs through, in order. We don't get live
// progress events, so the label advances on a timer and HOLDS on the last stage
// until the run actually finishes — it never wraps back to the start.
const SYNC_ISLAND_PHASES = ["Teller", "sources", "evidence", "AI enrichment", "finishing up"];
export const SYNC_ISLAND_PHASE_COUNT = SYNC_ISLAND_PHASES.length;

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const RELATIVE_TIME_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { seconds: 31_536_000, unit: "year" },
  { seconds: 2_592_000, unit: "month" },
  { seconds: 86_400, unit: "day" },
  { seconds: 3_600, unit: "hour" },
  { seconds: 60, unit: "minute" }
];

export function deriveSyncIslandState({
  accountCount,
  lastSyncedAt,
  phaseIndex = 0,
  source,
  status,
  transactionCount
}: SyncIslandStateInput): SyncIslandState {
  const syncedLabel = source === "teller" ? `Synced ${formatRelativeSyncTime(lastSyncedAt)}` : "No Teller data";
  const detail =
    source === "teller"
      ? `${accountCount.toLocaleString()} accounts, ${transactionCount.toLocaleString()} transactions`
      : "Connect Teller in Settings";
  // Clamp (not modulo) so phases advance once and hold — no looping.
  const phaseLabel = SYNC_ISLAND_PHASES[Math.min(phaseIndex, SYNC_ISLAND_PHASES.length - 1)] ?? SYNC_ISLAND_PHASES[0];

  if (status === "syncing") {
    return {
      compactLabel: "Syncing",
      detail,
      phaseLabel,
      tone: "syncing",
      view: "syncing"
    };
  }

  if (status === "success") {
    return {
      compactLabel: "Sync complete",
      detail,
      phaseLabel: "Complete",
      tone: "success",
      view: "success"
    };
  }

  if (status === "error") {
    return {
      compactLabel: "Sync failed",
      detail,
      phaseLabel: "Needs attention",
      tone: "error",
      view: "error"
    };
  }

  return {
    compactLabel: syncedLabel,
    detail,
    phaseLabel,
    tone: "idle",
    view: null
  };
}

/** Relative time (e.g. "3 min ago", "just now") for the idle sync pill -- computed at render time. */
function formatRelativeSyncTime(lastSyncedAt?: string) {
  if (!lastSyncedAt) {
    return "at an unknown time";
  }

  const date = new Date(lastSyncedAt);

  if (Number.isNaN(date.getTime())) {
    return "at an unknown time";
  }

  const elapsedSeconds = Math.round((date.getTime() - Date.now()) / 1000);

  if (Math.abs(elapsedSeconds) < 45) {
    return "just now";
  }

  for (const { seconds, unit } of RELATIVE_TIME_UNITS) {
    if (Math.abs(elapsedSeconds) >= seconds) {
      return relativeTimeFormatter.format(Math.round(elapsedSeconds / seconds), unit);
    }
  }

  return relativeTimeFormatter.format(Math.round(elapsedSeconds / 60), "minute");
}
