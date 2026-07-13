// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { SyncScheduleRecord } from "@/lib/db/finance-db";
import { isDue } from "@/lib/sync-schedule-ticker";

const now = Date.parse("2026-05-31T02:00:00.000Z");

function schedule(overrides: Partial<SyncScheduleRecord>): SyncScheduleRecord {
  return {
    createdAt: "2026-05-31T00:00:00.000Z",
    enabled: true,
    id: "whole_app",
    intervalMinutes: 60,
    nextRunAt: "2026-05-31T01:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides
  };
}

describe("sync schedule due checks", () => {
  it("does not run a disabled schedule", () => {
    expect(isDue(schedule({ enabled: false }), now)).toBe(false);
  });

  it("does not run a schedule whose next run is in the future", () => {
    expect(isDue(schedule({ nextRunAt: "2026-05-31T02:00:01.000Z" }), now)).toBe(false);
  });

  it("runs a schedule whose next run is in the past", () => {
    expect(isDue(schedule({ nextRunAt: "2026-05-31T01:59:59.000Z" }), now)).toBe(true);
  });
});
