import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance-data", () => ({
  getFinanceData: async () => ({
    accounts: [
      { id: "acct_a", institutionName: "A Bank", name: "Checking", type: "checking" },
      { id: "acct_b", institutionName: "B Bank", name: "Savings", type: "savings" }
    ]
  })
}));

import { GET } from "@/app/api/v1/accounts/route";

function list(query: string) {
  return GET(new NextRequest(`http://localhost/api/v1/accounts?${query}`));
}

describe("list cursors", () => {
  it("pages after a known cursor", async () => {
    const response = await list("limit=1&starting_after=acct_a");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((row: { id: string }) => row.id)).toEqual(["acct_b"]);
  });

  it("answers 400 for a cursor that names no row instead of restarting at page 1", async () => {
    const response = await list("limit=1&starting_after=acct_deleted");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "resource_missing", param: "starting_after" });
    expect(body.error).toMatch(/acct_deleted/);
  });
});
