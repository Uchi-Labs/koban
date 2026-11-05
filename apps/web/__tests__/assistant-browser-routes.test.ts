import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ buildAssistantPrompt: vi.fn(), runAssistantDataTool: vi.fn() }));

vi.mock("@/lib/finance-assistant", () => ({
  buildAssistantPrompt: mocks.buildAssistantPrompt,
  isAssistantDataToolName: (name: string) => ["list_goals", "search_transactions"].includes(name),
  runAssistantDataTool: mocks.runAssistantDataTool
}));

import { POST as postPrompt } from "@/app/api/v1/assistant/prompt/route";
import { POST as postTool } from "@/app/api/v1/assistant/tools/[name]/route";

const request = (path: string, body: string) =>
  new Request(`http://localhost${path}`, { body, headers: { "content-type": "application/json" }, method: "POST" });
const callTool = (name: string, body: string) =>
  postTool(request(`/api/v1/assistant/tools/${name}`, body), { params: Promise.resolve({ name }) });

describe("POST /api/v1/assistant/prompt", () => {
  beforeEach(() => mocks.buildAssistantPrompt.mockReset());

  it("rejects a malformed body, a missing question, and a long one with 400s", async () => {
    for (const body of ["", "[1]", "{\"question\":\"  \"}", JSON.stringify({ question: "x".repeat(501) })]) {
      expect((await postPrompt(request("/api/v1/assistant/prompt", body))).status).toBe(400);
    }
    expect(mocks.buildAssistantPrompt).not.toHaveBeenCalled();
  });

  it("returns the prepared prompt as an assistant_prompt object", async () => {
    mocks.buildAssistantPrompt.mockResolvedValue({ max_steps: 6, messages: [], meta: { type: "meta" }, tools: [] });

    const response = await postPrompt(request("/api/v1/assistant/prompt", JSON.stringify({ question: " Netflix? " })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ max_steps: 6, messages: [], meta: { type: "meta" }, object: "assistant_prompt", tools: [] });
    expect(mocks.buildAssistantPrompt).toHaveBeenCalledWith("Netflix?");
  });
});

describe("POST /api/v1/assistant/tools/:name", () => {
  beforeEach(() => mocks.runAssistantDataTool.mockReset());

  it("answers 404 for a tool that is not a ledger read, including show_visual", async () => {
    for (const name of ["show_visual", "delete_transactions"]) {
      const response = await callTool(name, "{}");
      expect(response.status).toBe(404);
    }
    expect(mocks.runAssistantDataTool).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not an object or input the schema rejects", async () => {
    expect((await callTool("search_transactions", "[]")).status).toBe(400);

    mocks.runAssistantDataTool.mockResolvedValue({ error: "from: Invalid", ok: false });
    const response = await callTool("search_transactions", JSON.stringify({ from: "October" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "from: Invalid" });
  });

  it("returns the tool's result in an assistant_tool_result object", async () => {
    mocks.runAssistantDataTool.mockResolvedValue({ ok: true, result: { goals: [] } });

    const response = await callTool("list_goals", "{}");

    expect(await response.json()).toEqual({ name: "list_goals", object: "assistant_tool_result", result: { goals: [] } });
    expect(mocks.runAssistantDataTool).toHaveBeenCalledWith("list_goals", {});
  });
});
