import { describe, expect, it, vi } from "vitest";
import { emptyModelAnswerMessage } from "@/lib/agent-answer";
import { createToolCallGuard, runBrowserAgent, type BrowserGenerate, type BrowserGenerateInput } from "@/lib/browser-llm/agent-loop";
import { executeBrowserToolCall } from "@/lib/browser-llm/tool-executor";
import type { AgentStreamEvent, AssistantPrompt } from "@/lib/finance-assistant";

const meta: AssistantPrompt["meta"] = {
  evidence: [],
  generatedAt: "2026-11-05T12:00:00.000Z",
  insights: [],
  metrics: [],
  mode: "llm_finance_agent",
  question: "What is our Netflix charge?",
  type: "meta"
};

const prompt: AssistantPrompt = {
  max_steps: 6,
  messages: [
    { content: "You are Koban.", role: "system" },
    { content: "{\"question\":\"What is our Netflix charge?\"}", role: "user" }
  ],
  meta,
  tools: [
    { description: "Show a visual.", name: "show_visual", parameters: { properties: { html: { type: "string" }, title: { type: "string" } }, type: "object" } },
    { description: "Search.", name: "search_transactions", parameters: { properties: { merchant: { type: "string" } }, type: "object" } }
  ]
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });

function apiFetch(toolResponse: (name: string, body: unknown) => Response = () => json({ result: { total_spent: 215.88 } })) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === "/api/v1/assistant/prompt") return json({ object: "assistant_prompt", ...prompt });
    const tool = /^\/api\/v1\/assistant\/tools\/(.+)$/.exec(path);
    if (tool) return toolResponse(decodeURIComponent(tool[1]), JSON.parse(String(init?.body ?? "{}")));
    return json({ error: "not found" }, 404);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** A model that speaks each scripted generation in two pieces and records the chat it was given. */
function scriptedModel(generations: string[]) {
  const calls: BrowserGenerateInput[] = [];
  const generate: BrowserGenerate = async (input) => {
    calls.push({ ...input, messages: [...input.messages] });
    const text = generations[calls.length - 1] ?? "</think>";
    const middle = Math.floor(text.length / 2);
    input.onText(text.slice(0, middle));
    input.onText(text.slice(middle));
    return text;
  };
  return { calls, generate };
}

async function collect(events: AsyncIterable<AgentStreamEvent>) {
  const out: AgentStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const answerText = (events: AgentStreamEvent[]) =>
  events.flatMap((event) => (event.type === "delta" ? [event.text] : [])).join("");

describe("runBrowserAgent", () => {
  it("runs a tool through the API, feeds the result back, and streams only the reply", async () => {
    const fetcher = apiFetch();
    const model = scriptedModel([
      "Need the charges.</think><tool_call>\n<function=search_transactions>\n<parameter=merchant>\nNetflix\n</parameter>\n</function>\n</tool_call>",
      "The search found it.</think>Netflix is $17.99 a month."
    ]);

    const events = await collect(runBrowserAgent({ fetcher, generate: model.generate, question: "What is our Netflix charge?" }));

    expect(events[0]).toEqual(meta);
    expect(answerText(events)).toBe("Netflix is $17.99 a month.");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/assistant/tools/search_transactions",
      expect.objectContaining({ body: JSON.stringify({ merchant: "Netflix" }), method: "POST" })
    );

    const second = model.calls[1];
    expect(second.tools.map((tool) => tool.function.name)).toEqual(["show_visual", "search_transactions"]);
    expect(second.messages.slice(2)).toEqual([
      {
        content: "",
        role: "assistant",
        thinking: "Need the charges.",
        tool_calls: [{ function: { arguments: { merchant: "Netflix" }, name: "search_transactions" }, type: "function" }]
      },
      { content: JSON.stringify({ total_spent: 215.88 }), role: "tool" }
    ]);
  });

  it("draws show_visual in the browser without calling the API", async () => {
    const fetcher = apiFetch();
    const model = scriptedModel([
      "</think><tool_call>\n<function=show_visual>\n<parameter=title>\nNetflix by month\n</parameter>\n<parameter=html>\n<svg></svg>\n</parameter>\n</function>\n</tool_call>",
      "</think>Here is the trend."
    ]);

    const events = await collect(runBrowserAgent({ fetcher, generate: model.generate, question: "Chart Netflix" }));

    expect(events).toContainEqual({
      type: "visual",
      visual: { html: "<svg></svg>", id: `visual_${meta.generatedAt}_0`, title: "Netflix by month" }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(model.calls[1].messages.at(-1)).toEqual({ content: "Shown to the user above your reply.", role: "tool" });
  });

  it("hands a failed tool's error to the model instead of ending the answer", async () => {
    const fetcher = apiFetch(() => json({ error: "from: Invalid" }, 400));
    const model = scriptedModel([
      "</think><tool_call>\n<function=search_transactions>\n<parameter=merchant>\nNetflix\n</parameter>\n</function>\n</tool_call>",
      "</think>I could not search that range."
    ]);

    const events = await collect(runBrowserAgent({ fetcher, generate: model.generate, question: "q" }));

    expect(model.calls[1].messages.at(-1)).toEqual({ content: JSON.stringify({ error: "from: Invalid" }), role: "tool" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("stops after six steps and reports the empty answer, as server Ask does", async () => {
    const call = "</think><tool_call>\n<function=search_transactions>\n<parameter=merchant>\nNetflix\n</parameter>\n</function>\n</tool_call>";
    const model = scriptedModel(Array.from({ length: 10 }, () => call));

    const events = await collect(runBrowserAgent({ fetcher: apiFetch(), generate: model.generate, question: "q" }));

    expect(model.calls).toHaveLength(6);
    expect(events.at(-1)).toEqual({ message: emptyModelAnswerMessage, type: "error" });
  });

  it("reports the empty answer when the model spends its budget thinking", async () => {
    const model = scriptedModel(["thinking and thinking"]);

    const events = await collect(runBrowserAgent({ fetcher: apiFetch(), generate: model.generate, question: "q" }));

    expect(answerText(events)).toBe("");
    expect(events.at(-1)).toEqual({ message: emptyModelAnswerMessage, type: "error" });
  });

  it("ends with the model's error when generation fails", async () => {
    const generate: BrowserGenerate = async () => {
      throw new Error("GPU device was lost");
    };

    const events = await collect(runBrowserAgent({ fetcher: apiFetch(), generate, question: "q" }));

    expect(events.at(-1)).toEqual({ message: "The model could not answer: GPU device was lost", type: "error" });
  });

  it("throws the API's message when the question cannot be prepared", async () => {
    const fetcher = vi.fn(async () => json({ error: "Question must be 500 characters or fewer." }, 400)) as unknown as typeof fetch;

    await expect(collect(runBrowserAgent({ fetcher, generate: scriptedModel([]).generate, question: "q" }))).rejects.toThrow(
      "Question must be 500 characters or fewer."
    );
  });
});

describe("executeBrowserToolCall", () => {
  it("refuses a tool the model was not given, without a request", async () => {
    const fetcher = apiFetch();

    await expect(
      executeBrowserToolCall({ arguments: {}, name: "delete_everything" }, prompt.tools, { fetcher })
    ).resolves.toEqual({ error: "There is no tool named delete_everything. Use one of: show_visual, search_transactions." });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns the result, or the API's error in either envelope", async () => {
    const call = { arguments: { merchant: "Netflix" }, name: "search_transactions" };

    await expect(executeBrowserToolCall(call, prompt.tools, { fetcher: apiFetch() })).resolves.toEqual({ total_spent: 215.88 });
    await expect(
      executeBrowserToolCall(call, prompt.tools, { fetcher: apiFetch(() => json({ error: { message: "Unauthorized", type: "auth" } }, 401)) })
    ).resolves.toEqual({ error: "Unauthorized" });
    await expect(
      executeBrowserToolCall(call, prompt.tools, { fetcher: apiFetch(() => new Response("oops", { status: 502 })) })
    ).resolves.toEqual({ error: "The tool failed (HTTP 502)." });
  });
});

describe("createToolCallGuard", () => {
  it("passes text up to a tool call split across chunks and holds back the call", () => {
    const guard = createToolCallGuard();

    expect(guard.push("Let me check. <tool")).toBe("Let me check. ");
    expect(guard.push("_call>\n<function=x>")).toBe("");
    expect(guard.push("more")).toBe("");
    expect(guard.flush()).toBe("");
  });

  it("releases a held '<' that did not open a tool call", () => {
    const guard = createToolCallGuard();

    expect(guard.push("a <")).toBe("a ");
    expect(guard.push("b")).toBe("<b");
    expect(guard.push(" <t")).toBe(" ");
    expect(guard.flush()).toBe("<t");
  });
});
