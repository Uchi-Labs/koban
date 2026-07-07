import { describe, expect, it } from "vitest";
import { looksLikeQuestion } from "@/lib/agent-question";

describe("looksLikeQuestion", () => {
  it("recognizes direct questions and finance-style commands", () => {
    expect(looksLikeQuestion("Where did my money go?")).toBe(true);
    expect(looksLikeQuestion("show grocery spending")).toBe(true);
    expect(looksLikeQuestion("list my recurring charges")).toBe(true);
    expect(looksLikeQuestion("groceries last month")).toBe(false);
  });

  it("requires enough substance before showing the agent action", () => {
    expect(looksLikeQuestion("why")).toBe(false);
    expect(looksLikeQuestion("open")).toBe(false);
    expect(looksLikeQuestion("review transactions this month please")).toBe(true);
  });
});
