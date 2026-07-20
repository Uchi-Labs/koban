import { describe, expect, it } from "vitest";
import {
  groupAgentConversationsByDate,
  type AgentConversationSummary
} from "@/lib/agent-conversations";

describe("groupAgentConversationsByDate", () => {
  it("groups every local-day bucket in fixed order and sorts each bucket newest first", () => {
    const now = new Date(2026, 6, 15, 12);
    const conversations = [
      conversation("older", "2026-07-12T20:00:00"),
      conversation("today-early", "2026-07-15T08:00:00"),
      conversation("this-week", "2026-07-13T21:00:00"),
      conversation("yesterday", "2026-07-14T18:00:00"),
      conversation("today-late", "2026-07-15T11:00:00")
    ];

    expect(groupAgentConversationsByDate(conversations, now).map(({ label, conversations: items }) => ({
      ids: items.map((item) => item.id),
      label
    }))).toEqual([
      { ids: ["today-late", "today-early"], label: "Today" },
      { ids: ["yesterday"], label: "Yesterday" },
      { ids: ["this-week"], label: "This week" },
      { ids: ["older"], label: "Older" }
    ]);
  });

  it("uses Monday as the start-of-week boundary", () => {
    const now = new Date(2026, 6, 17, 12);

    expect(groupAgentConversationsByDate([
      conversation("previous-sunday", "2026-07-12T23:59:59"),
      conversation("current-monday", "2026-07-13T00:00:00")
    ], now).map(({ label, conversations }) => ({
      ids: conversations.map((item) => item.id),
      label
    }))).toEqual([
      { ids: ["current-monday"], label: "This week" },
      { ids: ["previous-sunday"], label: "Older" }
    ]);
  });

  it("omits empty buckets and safely places invalid dates in Older", () => {
    const now = new Date(2026, 6, 15, 12);
    const invalid = conversation("invalid", "not-a-date");

    expect(groupAgentConversationsByDate([], now)).toEqual([]);
    expect(groupAgentConversationsByDate([invalid], now)).toEqual([
      { conversations: [invalid], label: "Older" }
    ]);
  });
});

function conversation(id: string, updatedAt: string): AgentConversationSummary {
  return {
    auto_titled: false,
    created_at: updatedAt,
    id,
    object: "agent_conversation",
    title: id,
    updated_at: updatedAt
  };
}
