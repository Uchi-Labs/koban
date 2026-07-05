import { describe, expect, it } from "vitest";
import { enrichmentRunStepStatus, sourceSyncBatchStepStatus } from "@/lib/app-sync-service";

describe("app sync service", () => {
  it("marks hosted LLM enrichment as partial when provider output fails and local fallback continues", () => {
    expect(
      enrichmentRunStepStatus({
        provider: {
          completed: false,
          errorMessage: "LLM enrichment returned invalid JSON.",
          provider: {
            configured: true,
            model: "gpt-test",
            provider: "openai_compatible",
            status: "connected",
            timeoutMs: 20_000
          },
          source: "llm:openai_compatible:gpt-test",
          suggestionsAccepted: 0,
          suggestionsRejected: 0,
          suggestionsSeen: 0
        }
      })
    ).toBe("partial");
  });

  it("keeps local-only enrichment succeeded when no hosted provider is configured", () => {
    expect(
      enrichmentRunStepStatus({
        provider: {
          completed: false,
          provider: {
            configured: false,
            provider: "none",
            status: "not_configured",
            timeoutMs: 20_000
          },
          suggestionsAccepted: 0,
          suggestionsRejected: 0,
          suggestionsSeen: 0
        }
      })
    ).toBe("succeeded");
  });

  it("marks hosted LLM enrichment as partial when every hosted suggestion is rejected", () => {
    expect(
      enrichmentRunStepStatus({
        provider: {
          completed: true,
          provider: {
            configured: true,
            model: "gpt-test",
            provider: "openai_compatible",
            status: "connected",
            timeoutMs: 20_000
          },
          source: "llm:openai_compatible:gpt-test",
          suggestionsAccepted: 0,
          suggestionsRejected: 10,
          suggestionsSeen: 10
        }
      })
    ).toBe("partial");
  });

  it("marks source sync summaries partial when any refresh used cached source records", () => {
    expect(
      sourceSyncBatchStepStatus({
        sourcesErrored: 0,
        sourcesPartial: 1,
        sourcesStale: 0
      })
    ).toBe("partial");
  });
});
