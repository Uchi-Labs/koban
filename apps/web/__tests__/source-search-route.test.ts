// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchSourceLive = vi.hoisted(() => vi.fn());
vi.mock("@/lib/source-adapters", () => ({ searchSourceLive }));

import { POST } from "@/app/api/v1/sources/[sourceId]/search/route";

const call = (body: unknown, sourceId = "source_gmail__personal") =>
  POST(new Request("http://localhost/search", { body: JSON.stringify(body), method: "POST" }), {
    params: Promise.resolve({ sourceId })
  });

describe("live source search route", () => {
  beforeEach(() => {
    searchSourceLive.mockReset();
    searchSourceLive.mockResolvedValue({
      items: [{ externalId: "m1", id: "src_m1", kind: "email", occurredAt: "2026-09-08T14:12:00.000Z", sourceId: "source_gmail__personal", summary: "From: Honda", title: "Invoice" }],
      run: { evidenceLinksSuggested: 1, itemsWritten: 1 },
      sourceId: "source_gmail__personal"
    });
  });

  it("searches the window and returns stored matches", async () => {
    const response = await call({ from: "2026-09-06", q: "honda", to: "2026-09-11" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ external_id: "m1", occurred_at: "2026-09-08T14:12:00.000Z", title: "Invoice" }],
      evidence_links_suggested: 1,
      items_written: 1,
      object: "source_search"
    });
    expect(searchSourceLive).toHaveBeenCalledWith("source_gmail__personal", { from: "2026-09-06", limit: undefined, query: "honda", to: "2026-09-11" });
  });

  it.each([
    [{ to: "2026-09-11" }],
    [{ from: "2026-02-30", to: "2026-03-02" }],
    [{ from: "2026-09-11", to: "2026-09-06" }],
    [{ from: "2026-01-01", to: "2026-03-01" }],
    [{ from: "2026-09-06", limit: 51, to: "2026-09-11" }],
    [{ from: "2026-09-06", q: 42, to: "2026-09-11" }]
  ])("rejects a malformed request with 400: %j", async (body) => {
    const response = await call(body);

    expect(response.status).toBe(400);
    expect(searchSourceLive).not.toHaveBeenCalled();
  });
});
