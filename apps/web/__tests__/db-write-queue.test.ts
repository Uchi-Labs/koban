// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createDbWriteQueue } from "@/lib/db/db-write-queue";

describe("database write queue ownership", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retains ownership after timeout until the cancelled operation settles", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let activeWriters = 0;
    let maximumActiveWriters = 0;
    const queue = createDbWriteQueue({
      runInScope: async (operation) => await operation(),
      timeoutMs: 10
    });

    const first = queue.enqueue(async (signal) => {
      activeWriters += 1;
      maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
      events.push("first:start");
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          events.push("first:abort");
          setTimeout(resolve, 5);
        }, { once: true });
      });
      events.push("first:settled");
      activeWriters -= 1;
    });
    const second = queue.enqueue(async () => {
      activeWriters += 1;
      maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
      events.push("second:start");
      activeWriters -= 1;
    });
    const firstRejection = expect(first).rejects.toThrow("Cancellation was requested");

    await vi.advanceTimersByTimeAsync(10);
    await firstRejection;
    expect(events).toEqual(["first:start", "first:abort"]);

    await vi.advanceTimersByTimeAsync(5);
    await second;
    await queue.drain();

    expect(events).toEqual(["first:start", "first:abort", "first:settled", "second:start"]);
    expect(maximumActiveWriters).toBe(1);
  });

  it("drains an ordinary rejection before starting the successor", async () => {
    const events: string[] = [];
    const queue = createDbWriteQueue({
      runInScope: async (operation) => await operation(),
      timeoutMs: 1_000
    });

    const first = queue.enqueue(async () => {
      events.push("first");
      throw new Error("write failed");
    });
    const second = queue.enqueue(async () => {
      events.push("second");
      return "completed";
    });

    await expect(first).rejects.toThrow("write failed");
    await expect(second).resolves.toBe("completed");
    await queue.drain();
    expect(events).toEqual(["first", "second"]);
  });

  it("does not start work whose external signal was aborted while queued", async () => {
    let releaseFirst: () => void = () => undefined;
    const externalController = new AbortController();
    const events: string[] = [];
    const queue = createDbWriteQueue({
      runInScope: async (operation) => await operation(),
      timeoutMs: 1_000
    });

    const first = queue.enqueue(async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    const second = queue.enqueue(async (queueSignal) => {
      AbortSignal.any([externalController.signal, queueSignal]).throwIfAborted();
      events.push("second:work");
    });

    await Promise.resolve();
    externalController.abort(new Error("request cancelled"));
    releaseFirst();
    await first;
    await expect(second).rejects.toThrow("request cancelled");
    await queue.drain();
    expect(events).toEqual([]);
  });
});
