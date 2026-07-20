import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyNameOverrides, getAccountNameOverrides, setAccountNameOverride } from "@/lib/account-overlays";
import { PATCH } from "@/app/api/v1/accounts/[accountId]/route";

const kv = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@/lib/db/finance-db", () => ({
  readSyncStateValue: async (key: string) => kv.store.get(key),
  writeSyncStateValue: async (key: string, value: string) => void kv.store.set(key, value)
}));

vi.mock("@/lib/finance-data", () => ({
  getFinanceData: async () => ({
    accounts: [{ currency: "USD", id: "acct_1", includedInNetWorth: true, name: "TOTAL CHECKING", type: "checking" }]
  })
}));

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/v1/accounts/acct_1", { body: JSON.stringify(body), method: "PATCH" }),
    { params: Promise.resolve({ accountId: "acct_1" }) }
  );
}

describe("account rename overlay", () => {
  beforeEach(() => kv.store.clear());

  it("persists an alias in KV and merges it over the provider name", async () => {
    await setAccountNameOverride("acct_1", "Chase Joint");
    const overrides = await getAccountNameOverrides();
    expect(overrides).toEqual({ acct_1: "Chase Joint" });
    expect(applyNameOverrides([{ id: "acct_1", name: "TOTAL CHECKING" }, { id: "acct_2", name: "SoFi Savings" }], overrides))
      .toEqual([{ id: "acct_1", name: "Chase Joint" }, { id: "acct_2", name: "SoFi Savings" }]);
  });

  it("renames via PATCH and clears back to the provider name with null", async () => {
    const renamed = await patch({ name: "  Chase Joint  " });
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({ name: "Chase Joint" });
    expect(await getAccountNameOverrides()).toEqual({ acct_1: "Chase Joint" });

    const cleared = await patch({ name: null });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({ name: "TOTAL CHECKING" });
    expect(await getAccountNameOverrides()).toEqual({});
  });

  it("rejects blank names and bodies with nothing to update", async () => {
    expect((await patch({ name: "   " })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });
});
