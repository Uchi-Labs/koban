// @vitest-environment node

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { runSyncStepEffect } from "@/lib/app-sync-service";
import { SourceRefreshError } from "@/lib/effect/sync-errors";

describe("app sync Effect steps", () => {
  it("returns an error step when a sync step times out", async () => {
    const result = await Effect.runPromise(
      runSyncStepEffect(Effect.sleep("50 millis"), {
        timeout: "5 millis",
        timeoutError: () => new SourceRefreshError({ message: "Source refresh timed out." })
      })
    );

    expect(result).toEqual({
      error: "Source refresh timed out.",
      status: "error"
    });
  });
});
