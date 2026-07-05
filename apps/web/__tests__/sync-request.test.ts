import { describe, expect, it } from "vitest";
import { parseOptionalEnrichmentLimit, parseOptionalSourceIds } from "@/lib/sync-request";

describe("sync request parsing", () => {
  it("accepts omitted and known source ids", () => {
    expect(parseOptionalSourceIds(undefined)).toEqual({
      ok: true,
      value: undefined
    });
    expect(parseOptionalSourceIds(["source_instacart", "source_instacart", "source_airbnb"])).toEqual({
      ok: true,
      value: ["source_instacart", "source_airbnb"]
    });
  });

  it("rejects malformed or unknown source ids before sync work starts", () => {
    expect(parseOptionalSourceIds("source_instacart")).toEqual({
      error: "source_ids must be an array of source adapter ids.",
      ok: false
    });
    expect(parseOptionalSourceIds([])).toEqual({
      error: "source_ids must include at least one source adapter id when provided.",
      ok: false
    });
    expect(parseOptionalSourceIds(["source_instacart", 7])).toEqual({
      error: "source_ids must contain only source adapter ids.",
      ok: false
    });
    expect(parseOptionalSourceIds(["source_missing"])).toEqual({
      error: "Unknown source adapter: source_missing.",
      ok: false
    });
  });

  it("rejects non-numeric enrichment limits", () => {
    expect(parseOptionalEnrichmentLimit(undefined)).toEqual({
      ok: true,
      value: undefined
    });
    expect(parseOptionalEnrichmentLimit(25)).toEqual({
      ok: true,
      value: 25
    });
    expect(parseOptionalEnrichmentLimit("25")).toEqual({
      error: "enrichment_limit must be a finite number.",
      ok: false
    });
  });
});
