import { describe, expect, it } from "vitest";
import { deriveSyncIslandState } from "@/lib/sync-island-state";
import { getSwipeReleaseSide } from "@/lib/swipe-release";

describe("Wave B swipe threshold mapping", () => {
  it("opens the review action on a deliberate right swipe", () => {
    expect(
      getSwipeReleaseSide({
        latestX: 42,
        leftWidth: 58,
        openSide: null,
        rightWidth: 58,
        velocityX: 40
      })
    ).toBe("left");
  });

  it("opens the categorize action on a deliberate left swipe", () => {
    expect(
      getSwipeReleaseSide({
        latestX: -42,
        leftWidth: 58,
        openSide: null,
        rightWidth: 58,
        velocityX: -40
      })
    ).toBe("right");
  });

  it("closes an open row when released below the close ratio", () => {
    expect(
      getSwipeReleaseSide({
        latestX: 22,
        leftWidth: 58,
        openSide: "left",
        rightWidth: 58,
        velocityX: 0
      })
    ).toBeNull();
  });
});

describe("Wave B sync island state", () => {
  it("maps idle Teller data to a compact synced pill", () => {
    const state = deriveSyncIslandState({
      accountCount: 2,
      lastSyncedAt: "2026-07-06T06:09:00.000Z",
      source: "teller",
      status: "idle",
      transactionCount: 1200
    });

    expect(state.view).toBeNull();
    expect(state.tone).toBe("idle");
    expect(state.compactLabel).toContain("Synced");
    expect(state.detail).toBe("2 accounts, 1,200 transactions");
  });

  it("maps syncing to an expanded phased activity view", () => {
    const state = deriveSyncIslandState({
      accountCount: 2,
      phaseIndex: 2,
      source: "teller",
      status: "syncing",
      transactionCount: 1200
    });

    expect(state.view).toBe("syncing");
    expect(state.tone).toBe("syncing");
    expect(state.phaseLabel).toBe("Semantic");
  });

  it("maps completion and errors to flash views", () => {
    expect(
      deriveSyncIslandState({
        accountCount: 0,
        source: "empty",
        status: "success",
        transactionCount: 0
      }).view
    ).toBe("success");

    expect(
      deriveSyncIslandState({
        accountCount: 0,
        source: "empty",
        status: "error",
        transactionCount: 0
      }).view
    ).toBe("error");
  });
});
