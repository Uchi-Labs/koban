import { describe, expect, it } from "vitest";
import { parseAgentStreamChunk, parseAgentStreamLine } from "@/lib/hooks/use-agent-stream";

describe("agent stream NDJSON parser", () => {
  it("buffers partial lines and parses complete events", () => {
    const first = parseAgentStreamChunk("", '{"type":"meta","question":"Where","mode":"local_semantic_agent"');

    expect(first.events).toEqual([]);
    expect(first.remaining).toContain('"question":"Where"');

    const second = parseAgentStreamChunk(
      first.remaining,
      ',"metrics":[],"evidence":[],"insights":[],"generatedAt":"2026-07-06T00:00:00.000Z"}\n{"type":"delta","text":"Answer"}\n'
    );

    expect(second.remaining).toBe("");
    expect(second.events).toEqual([
      {
        evidence: [],
        generatedAt: "2026-07-06T00:00:00.000Z",
        insights: [],
        metrics: [],
        mode: "local_semantic_agent",
        question: "Where",
        type: "meta"
      },
      {
        text: "Answer",
        type: "delta"
      }
    ]);
  });

  it("ignores blank lines and parses terminal events", () => {
    expect(parseAgentStreamLine("\n")).toBeNull();
    expect(parseAgentStreamLine('{"type":"done"}')).toEqual({ type: "done" });
  });
});
