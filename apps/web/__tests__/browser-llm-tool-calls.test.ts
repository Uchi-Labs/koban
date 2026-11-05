import { describe, expect, it } from "vitest";
import { parseModelOutput, type BrowserToolDefinition } from "@/lib/browser-llm/tool-calls";

const tools: BrowserToolDefinition[] = [
  {
    description: "Search transactions",
    name: "search_transactions",
    parameters: { properties: { from: { type: "string" }, merchant: { type: "string" } }, type: "object" }
  },
  {
    description: "A tool with typed parameters",
    name: "typed_tool",
    parameters: { properties: { flags: { type: "array" }, limit: { type: "integer" } }, type: "object" }
  }
];

describe("parseModelOutput", () => {
  it("reads LFM3's XML tool call after the reasoning block", () => {
    const output = parseModelOutput(
      "The user asks about Netflix. I should search.</think><tool_call>\n<function=search_transactions>\n<parameter=merchant>\nNetflix\n</parameter>\n<parameter=from>\n2026-01-01\n</parameter>\n</function>\n</tool_call>",
      tools
    );

    expect(output).toEqual({
      content: "",
      thinking: "The user asks about Netflix. I should search.",
      toolCalls: [{ arguments: { from: "2026-01-01", merchant: "Netflix" }, name: "search_transactions" }]
    });
  });

  it("keeps a string parameter that looks like a number as a string, and parses typed ones", () => {
    const output = parseModelOutput(
      "</think><tool_call>\n<function=search_transactions>\n<parameter=merchant>\n2026\n</parameter>\n</function>\n</tool_call>\n\n<tool_call>\n<function=typed_tool>\n<parameter=limit>\n5\n</parameter>\n<parameter=flags>\n[\"a\"]\n</parameter>\n</function>\n</tool_call>",
      tools
    );

    expect(output.toolCalls).toEqual([
      { arguments: { merchant: "2026" }, name: "search_transactions" },
      { arguments: { flags: ["a"], limit: 5 }, name: "typed_tool" }
    ]);
  });

  it("keeps a multi-line parameter, such as a visual's HTML, intact", () => {
    const html = "<!doctype html>\n<html><body>\n<svg></svg>\n</body></html>";
    const output = parseModelOutput(
      `</think><tool_call>\n<function=show_visual>\n<parameter=title>\nSpending\n</parameter>\n<parameter=html>\n${html}\n</parameter>\n</function>\n</tool_call>`
    );

    expect(output.toolCalls[0]).toEqual({ arguments: { html, title: "Spending" }, name: "show_visual" });
  });

  it("accepts a JSON tool call inside the same tags", () => {
    const output = parseModelOutput('</think><tool_call>{"name": "list_goals", "arguments": {}}</tool_call>', tools);

    expect(output.toolCalls).toEqual([{ arguments: {}, name: "list_goals" }]);
  });

  it("returns the reply without reasoning when there is no tool call", () => {
    const output = parseModelOutput("Thinking it over.</think>\n\nYour Netflix plan is $17.99 a month.", tools);

    expect(output).toEqual({ content: "Your Netflix plan is $17.99 a month.", thinking: "Thinking it over.", toolCalls: [] });
  });

  it("treats a generation that never closed its reasoning as reasoning only", () => {
    const output = parseModelOutput("Still thinking when the budget ran out", tools);

    expect(output).toEqual({ content: "", thinking: "Still thinking when the budget ran out", toolCalls: [] });
  });

  it("ignores a tool call whose body is neither the XML nor JSON form", () => {
    expect(parseModelOutput("</think><tool_call>search Netflix</tool_call>", tools).toolCalls).toEqual([]);
  });

  it("reads a tool call the generation cut off before </tool_call>", () => {
    const output = parseModelOutput(
      "</think><tool_call>\n<function=search_transactions>\n<parameter=merchant>\nCostco\n</parameter>\n</function>",
      tools
    );

    expect(output.toolCalls).toEqual([{ arguments: { merchant: "Costco" }, name: "search_transactions" }]);
  });
});
