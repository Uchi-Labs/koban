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

const SYNC_ISLAND_PHASES = ["Teller", "Evidence", "Semantic", "AI"];

const syncTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit"
});

export function deriveSyncIslandState({
  accountCount,
  lastSyncedAt,
  phaseIndex = 0,
  source,
  status,
  transactionCount
}: SyncIslandStateInput): SyncIslandState {
  const syncedLabel = source === "teller" ? `Synced - ${formatSyncTime(lastSyncedAt)}` : "No Teller data";
  const detail =
    source === "teller"
      ? `${accountCount.toLocaleString()} accounts, ${transactionCount.toLocaleString()} transactions`
      : "Connect Teller in Settings";
  const phaseLabel = SYNC_ISLAND_PHASES[phaseIndex % SYNC_ISLAND_PHASES.length] ?? SYNC_ISLAND_PHASES[0];

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

function formatSyncTime(lastSyncedAt?: string) {
  if (!lastSyncedAt) {
    return "unknown";
  }

  const date = new Date(lastSyncedAt);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return syncTimeFormatter.format(date);
}
