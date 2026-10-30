import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentStream } from "@/lib/hooks/use-agent-stream";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAgentStream", () => {
  it("releases every queued chunk before reporting done", async () => {
    const lines = [
      { type: "meta", chart: undefined, evidence: [], generatedAt: "2026-10-28T00:00:00.000Z", insights: [], metrics: [], mode: "llm_finance_agent", question: "How are we doing?" },
      { type: "delta", text: "October is " },
      { type: "delta", text: "running $393 under budget, with food the largest flexible category so far." },
      { type: "visual", visual: { html: "<svg></svg>", id: "v1", title: "Budget" } },
      { type: "done" }
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join("\n") + "\n"));
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    const { result } = renderHook(() => useAgentStream());
    act(() => result.current.ask("How are we doing?"));

    await waitFor(() => expect(result.current.status).toBe("done"), { timeout: 5000 });
    expect(result.current.answer).toBe(
      "October is running $393 under budget, with food the largest flexible category so far."
    );
    expect(result.current.meta?.visuals?.map((visual) => visual.title)).toEqual(["Budget"]);
  });
});
