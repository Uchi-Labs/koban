// @vitest-environment node

import type { Account as SnapTradeAccount, Snaptrade } from "snaptrade-typescript-sdk";
import { SnaptradeError } from "snaptrade-typescript-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeFinanceDbForTests,
  readFinanceDbSnapshot,
  replaceSnapTradeInvestmentSnapshot,
  upsertAccountBalanceSnapshots
} from "@/lib/db/finance-db";
import {
  accountIdForSnapTrade,
  backfillSnapTradeBalanceHistory,
  createSnapTradeBalanceSnapshot,
  dropLeadingZeroBalanceHistory,
  mapSnapTradeAccountToDomain,
  mapSnapTradeBalanceHistory,
  providerConnectionIdForSnapTrade,
  snapTradeBalanceBackfillSource,
  type StoredSnapTradeUser
} from "@/lib/snaptrade-server";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
  vi.restoreAllMocks();
});

describe("mapSnapTradeBalanceHistory", () => {
  it("maps history items to one deterministic snapshot per date", () => {
    const snapshots = mapSnapTradeBalanceHistory({
      accountId: "snaptrade_acct_alpha",
      currency: "USD",
      history: [
        { date: "2026-07-06", total_value: "11228.38000000" },
        { date: "2026-07-05", total_value: "11100.00000000" }
      ]
    });

    expect(snapshots).toEqual([
      {
        id: "snaptrade_acct_alpha_backfill_20260706",
        accountId: "snaptrade_acct_alpha",
        asOfDate: "2026-07-06",
        capturedAt: "2026-07-06T00:00:00.000Z",
        ledgerBalance: 11228.38,
        currency: "USD",
        source: snapTradeBalanceBackfillSource
      },
      {
        id: "snaptrade_acct_alpha_backfill_20260705",
        accountId: "snaptrade_acct_alpha",
        asOfDate: "2026-07-05",
        capturedAt: "2026-07-05T00:00:00.000Z",
        ledgerBalance: 11100,
        currency: "USD",
        source: snapTradeBalanceBackfillSource
      }
    ]);
  });

  it("collapses duplicate dates to a single snapshot, last item winning", () => {
    const snapshots = mapSnapTradeBalanceHistory({
      accountId: "snaptrade_acct_alpha",
      currency: "USD",
      history: [
        { date: "2026-07-06", total_value: "100.00" },
        { date: "2026-07-06", total_value: "250.00" }
      ]
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ asOfDate: "2026-07-06", ledgerBalance: 250 });
  });

  it("drops malformed dates and non-finite values instead of synthesizing points", () => {
    const snapshots = mapSnapTradeBalanceHistory({
      accountId: "snaptrade_acct_alpha",
      currency: "USD",
      history: [
        { date: "not-a-date", total_value: "100.00" },
        { date: "2026-07-06", total_value: "not-a-number" },
        { date: "2026-07-06", total_value: null },
        { date: undefined, total_value: "5.00" },
        { date: "2026-07-04", total_value: "42.00" }
      ]
    });

    expect(snapshots).toEqual([
      expect.objectContaining({ asOfDate: "2026-07-04", ledgerBalance: 42 })
    ]);
  });

  it("returns an empty array when the endpoint yields no history", () => {
    expect(mapSnapTradeBalanceHistory({ accountId: "x", currency: "USD", history: undefined })).toEqual([]);
    expect(mapSnapTradeBalanceHistory({ accountId: "x", currency: null, history: [] })).toEqual([]);
  });
});

describe("upsertAccountBalanceSnapshots", () => {
  it("adds backfill rows idempotently and preserves live intraday captures", async () => {
    useTempDb();
    const account = seedAccount();

    // Live intraday capture from a normal sync (source "snaptrade").
    const liveCapture = {
      id: `${account.id}_20260706153000000Z`,
      accountId: account.id,
      asOfDate: "2026-07-06",
      capturedAt: "2026-07-06T15:30:00.000Z",
      ledgerBalance: 11250.55,
      currency: "USD",
      source: "snaptrade"
    };

    await replaceSnapTradeInvestmentSnapshot(snapshotInput(account, [liveCapture]));

    const backfill = mapSnapTradeBalanceHistory({
      accountId: account.id,
      currency: "USD",
      history: [
        { date: "2026-07-06", total_value: "11228.38" },
        { date: "2026-07-05", total_value: "11100.00" },
        { date: "2026-07-04", total_value: "10990.00" }
      ]
    });

    const firstWrite = await upsertAccountBalanceSnapshots(backfill);
    expect(firstWrite).toBe(3);

    // Re-running the same backfill must not create duplicate rows.
    const secondWrite = await upsertAccountBalanceSnapshots(backfill);
    expect(secondWrite).toBe(3);

    const snapshot = await readFinanceDbSnapshot();
    const rows = snapshot?.balanceSnapshots ?? [];

    // 3 backfill rows + the untouched live intraday capture.
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.source === snapTradeBalanceBackfillSource)).toHaveLength(3);

    const live = rows.find((row) => row.id === liveCapture.id);
    expect(live).toMatchObject({ source: "snaptrade", ledgerBalance: 11250.55 });

    // One backfill row per date, keyed deterministically.
    const backfillDates = rows
      .filter((row) => row.source === snapTradeBalanceBackfillSource)
      .map((row) => row.asOfDate)
      .sort();
    expect(backfillDates).toEqual(["2026-07-04", "2026-07-05", "2026-07-06"]);
  }, 15_000);

  it("refreshes an existing backfill date in place on re-run", async () => {
    useTempDb();
    const account = seedAccount();
    await replaceSnapTradeInvestmentSnapshot(snapshotInput(account, []));

    await upsertAccountBalanceSnapshots(
      mapSnapTradeBalanceHistory({ accountId: account.id, currency: "USD", history: [{ date: "2026-07-06", total_value: "100.00" }] })
    );
    await upsertAccountBalanceSnapshots(
      mapSnapTradeBalanceHistory({ accountId: account.id, currency: "USD", history: [{ date: "2026-07-06", total_value: "175.50" }] })
    );

    const rows = (await readFinanceDbSnapshot())?.balanceSnapshots ?? [];
    const backfillRows = rows.filter((row) => row.source === snapTradeBalanceBackfillSource);
    expect(backfillRows).toHaveLength(1);
    expect(backfillRows[0].ledgerBalance).toBe(175.5);
  }, 15_000);

  it("skips snapshots whose account does not exist without failing the batch", async () => {
    useTempDb();
    const account = seedAccount();
    await replaceSnapTradeInvestmentSnapshot(snapshotInput(account, []));

    const written = await upsertAccountBalanceSnapshots([
      ...mapSnapTradeBalanceHistory({ accountId: account.id, currency: "USD", history: [{ date: "2026-07-06", total_value: "100.00" }] }),
      ...mapSnapTradeBalanceHistory({ accountId: "snaptrade_acct_ghost", currency: "USD", history: [{ date: "2026-07-06", total_value: "999.00" }] })
    ]);

    expect(written).toBe(1);
    const rows = (await readFinanceDbSnapshot())?.balanceSnapshots ?? [];
    expect(rows.filter((row) => row.source === snapTradeBalanceBackfillSource)).toHaveLength(1);
  }, 15_000);
});

describe("backfillSnapTradeBalanceHistory", () => {
  const user: StoredSnapTradeUser = {
    registeredAt: "2026-07-06T12:00:00.000Z",
    userId: "ai-finances-test",
    userSecret: "test-user-secret"
  };

  it("writes points for a healthy account and degrades a disabled account to a logged no-op", async () => {
    useTempDb();
    const account = seedAccount();
    await replaceSnapTradeInvestmentSnapshot(snapshotInput(account, []));

    const disabledError = new SnaptradeError(
      { message: "Feature not enabled", response: { status: 403 } } as unknown as ConstructorParameters<typeof SnaptradeError>[0],
      { detail: "This feature is not enabled for your account." },
      {}
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const client = {
      accountInformation: {
        getAccountBalanceHistory: vi.fn(async ({ accountId }: { accountId: string }) => {
          if (accountId === "snap-disabled") {
            throw disabledError;
          }
          return {
            status: 200,
            data: {
              currency: "USD",
              history: [
                { date: "2026-07-06", total_value: "11228.38" },
                { date: "2026-07-05", total_value: "11100.00" }
              ]
            }
          };
        })
      }
    } as unknown as Snaptrade;

    const result = await backfillSnapTradeBalanceHistory({
      accounts: [
        { accountId: account.id, snapTradeAccountId: "snap-account-1" },
        { accountId: accountIdForSnapTrade("snap-disabled"), snapTradeAccountId: "snap-disabled" }
      ],
      client,
      user
    });

    expect(result.attemptedAccounts).toBe(2);
    expect(result.disabled).toBe(true);
    expect(result.pointsWritten).toBe(2);
    expect(result.perAccount).toEqual([
      { accountId: account.id, points: 2 },
      { accountId: accountIdForSnapTrade("snap-disabled"), points: 0, error: "balanceHistory endpoint disabled" }
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disabled"));

    const rows = (await readFinanceDbSnapshot())?.balanceSnapshots ?? [];
    expect(rows.filter((row) => row.source === snapTradeBalanceBackfillSource)).toHaveLength(2);
  }, 15_000);

  it("skips an all-zero account, trims an account's leading zeros, and keeps zeros it reports after funding", async () => {
    useTempDb();
    const account = seedAccount();
    const providerConnectionId = providerConnectionIdForSnapTrade("auth-fidelity-1");
    const syncedAt = "2026-07-06T12:00:00.000Z";

    // RSU/ESPP-style accounts: SnapTrade returns "0.00" for every historical
    // date even though the account has real value today. That means "cannot
    // estimate", not "worth zero" — it must not be ingested at all.
    const allZeroAccount = mapSnapTradeAccountToDomain({
      account: createSnapTradeAccount({ id: "snap-all-zero", totalAmount: 276818.56 }),
      providerConnectionId,
      syncedAt
    });
    // The Interactive Brokers shape: SnapTrade pads the year before the broker
    // started reporting with zeros. That prefix is "no estimate", not history.
    const leadingZeroAccount = mapSnapTradeAccountToDomain({
      account: createSnapTradeAccount({ id: "snap-leading-zero", totalAmount: 50 }),
      providerConnectionId,
      syncedAt
    });
    // An account emptied after it was funded really is worth zero on those
    // later days, and those points must survive.
    const emptiedAccount = mapSnapTradeAccountToDomain({
      account: createSnapTradeAccount({ id: "snap-emptied", totalAmount: 0 }),
      providerConnectionId,
      syncedAt
    });

    if (!allZeroAccount || !leadingZeroAccount || !emptiedAccount) {
      throw new Error("expected mapped SnapTrade accounts");
    }

    const allZeroAccountId = allZeroAccount.id;
    const leadingZeroAccountId = leadingZeroAccount.id;
    const emptiedAccountId = emptiedAccount.id;

    await replaceSnapTradeInvestmentSnapshot(
      snapshotInput(account, [], [account, allZeroAccount, leadingZeroAccount, emptiedAccount])
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const client = {
      accountInformation: {
        getAccountBalanceHistory: vi.fn(async ({ accountId }: { accountId: string }) => {
          if (accountId === "snap-all-zero") {
            return {
              status: 200,
              data: {
                currency: "USD",
                history: [
                  { date: "2026-07-06", total_value: "0.00" },
                  { date: "2026-07-05", total_value: "0.00" },
                  { date: "2026-07-04", total_value: "0.00" }
                ]
              }
            };
          }

          if (accountId === "snap-leading-zero") {
            return {
              status: 200,
              data: {
                currency: "USD",
                history: [
                  { date: "2026-07-06", total_value: "50.00" },
                  { date: "2026-07-05", total_value: "0.00" },
                  { date: "2026-07-04", total_value: "0.00" }
                ]
              }
            };
          }

          if (accountId === "snap-emptied") {
            return {
              status: 200,
              data: {
                currency: "USD",
                history: [
                  { date: "2026-07-06", total_value: "0.00" },
                  { date: "2026-07-05", total_value: "0.00" },
                  { date: "2026-07-04", total_value: "42.00" }
                ]
              }
            };
          }

          return {
            status: 200,
            data: {
              currency: "USD",
              history: [{ date: "2026-07-06", total_value: "11228.38" }]
            }
          };
        })
      }
    } as unknown as Snaptrade;

    const result = await backfillSnapTradeBalanceHistory({
      accounts: [
        { accountId: account.id, snapTradeAccountId: "snap-account-1" },
        { accountId: allZeroAccountId, snapTradeAccountId: "snap-all-zero" },
        { accountId: leadingZeroAccountId, snapTradeAccountId: "snap-leading-zero" },
        { accountId: emptiedAccountId, snapTradeAccountId: "snap-emptied" }
      ],
      client,
      user
    });

    expect(result.attemptedAccounts).toBe(4);
    expect(result.disabled).toBe(false);
    // Healthy (1) + leading-zero trimmed to (1) + emptied kept whole (3) = 5;
    // all-zero contributes 0.
    expect(result.pointsWritten).toBe(5);
    expect(result.perAccount).toEqual([
      { accountId: account.id, points: 1 },
      {
        accountId: allZeroAccountId,
        points: 0,
        error: "provider returned no usable estimate (all-zero balance history)"
      },
      { accountId: leadingZeroAccountId, points: 1 },
      { accountId: emptiedAccountId, points: 3 }
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("all-zero history"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("dropped 2 leading zero day(s) before its first reported balance on 2026-07-06")
    );

    const rows = (await readFinanceDbSnapshot())?.balanceSnapshots ?? [];
    const backfillRows = rows.filter((row) => row.source === snapTradeBalanceBackfillSource);

    expect(backfillRows.some((row) => row.accountId === allZeroAccountId)).toBe(false);

    // Only the funded day survived for the leading-zero account.
    expect(
      backfillRows.filter((row) => row.accountId === leadingZeroAccountId).map((row) => row.asOfDate)
    ).toEqual(["2026-07-06"]);

    // The emptied account keeps its post-funding zeros: 42 on the 4th, then 0.
    expect(
      backfillRows
        .filter((row) => row.accountId === emptiedAccountId)
        .sort((left, right) => left.asOfDate.localeCompare(right.asOfDate))
        .map((row) => [row.asOfDate, row.ledgerBalance])
    ).toEqual([
      ["2026-07-04", 42],
      ["2026-07-05", 0],
      ["2026-07-06", 0]
    ]);
  }, 15_000);
});

describe("dropLeadingZeroBalanceHistory", () => {
  it("drops the leading zero run and returns the rest in date order", () => {
    // Deliberately supplied newest-first, the order SnapTrade actually returns.
    const trimmed = dropLeadingZeroBalanceHistory(
      mapSnapTradeBalanceHistory({
        accountId: "snaptrade_acct_ibkr",
        currency: "USD",
        history: [
          { date: "2026-08-04", total_value: "1690.00" },
          { date: "2026-08-03", total_value: "1683.90" },
          { date: "2026-08-02", total_value: "0.00" },
          { date: "2026-08-01", total_value: "0.00" }
        ]
      })
    );

    expect(trimmed.map((snapshot) => [snapshot.asOfDate, snapshot.ledgerBalance])).toEqual([
      ["2026-08-03", 1683.9],
      ["2026-08-04", 1690]
    ]);
  });

  it("keeps zeros that appear after the first reported balance", () => {
    const trimmed = dropLeadingZeroBalanceHistory(
      mapSnapTradeBalanceHistory({
        accountId: "snaptrade_acct_emptied",
        currency: "USD",
        history: [
          { date: "2026-08-01", total_value: "0.00" },
          { date: "2026-08-02", total_value: "500.00" },
          { date: "2026-08-03", total_value: "0.00" },
          { date: "2026-08-04", total_value: "0.00" }
        ]
      })
    );

    expect(trimmed.map((snapshot) => [snapshot.asOfDate, snapshot.ledgerBalance])).toEqual([
      ["2026-08-02", 500],
      ["2026-08-03", 0],
      ["2026-08-04", 0]
    ]);
  });

  it("returns nothing for an all-zero or empty history", () => {
    expect(
      dropLeadingZeroBalanceHistory(
        mapSnapTradeBalanceHistory({
          accountId: "snaptrade_acct_rsu",
          currency: "USD",
          history: [
            { date: "2026-08-01", total_value: "0.00" },
            { date: "2026-08-02", total_value: "0.00" }
          ]
        })
      )
    ).toEqual([]);
    expect(dropLeadingZeroBalanceHistory([])).toEqual([]);
  });

  it("does not mutate the history it was given", () => {
    const history = mapSnapTradeBalanceHistory({
      accountId: "snaptrade_acct_ibkr",
      currency: "USD",
      history: [
        { date: "2026-08-04", total_value: "1690.00" },
        { date: "2026-08-03", total_value: "0.00" }
      ]
    });

    dropLeadingZeroBalanceHistory(history);

    expect(history.map((snapshot) => snapshot.asOfDate)).toEqual(["2026-08-04", "2026-08-03"]);
  });
});

describe("createSnapTradeBalanceSnapshot", () => {
  it("keys the live snapshot on the day so repeat syncs upsert instead of appending", async () => {
    useTempDb();
    const account = seedAccount();
    await replaceSnapTradeInvestmentSnapshot(snapshotInput(account, []));

    // Two syncs a few hours apart on the same day, which is what the ~30 minute
    // scheduler actually does roughly 48 times over.
    const morning = createSnapTradeBalanceSnapshot({ ...account, currentBalance: 100 }, "2026-07-06T09:00:00.000Z");
    const evening = createSnapTradeBalanceSnapshot({ ...account, currentBalance: 175.5 }, "2026-07-06T21:30:00.000Z");
    const nextDay = createSnapTradeBalanceSnapshot({ ...account, currentBalance: 180 }, "2026-07-07T09:00:00.000Z");

    expect(morning.id).toBe(`${account.id}_20260706`);
    expect(evening.id).toBe(morning.id);
    expect(nextDay.id).toBe(`${account.id}_20260707`);

    // The backfill for the same day uses a different key, so the two sources
    // never overwrite each other.
    expect(morning.id).not.toBe(`${account.id}_backfill_20260706`);

    await upsertAccountBalanceSnapshots([morning]);
    await upsertAccountBalanceSnapshots([evening]);
    await upsertAccountBalanceSnapshots([nextDay]);

    const liveRows = ((await readFinanceDbSnapshot())?.balanceSnapshots ?? [])
      .filter((row) => row.source === "snaptrade")
      .sort((left, right) => left.asOfDate.localeCompare(right.asOfDate));

    // Three writes, two days, two rows: the second write of the 6th replaced
    // the first rather than adding a point to the balance chart.
    expect(liveRows.map((row) => [row.asOfDate, row.ledgerBalance, row.capturedAt])).toEqual([
      ["2026-07-06", 175.5, "2026-07-06T21:30:00.000Z"],
      ["2026-07-07", 180, "2026-07-07T09:00:00.000Z"]
    ]);
  }, 15_000);
});

function useTempDb() {
  testDbPath = mkdtempSync(path.join(tmpdir(), "ai-finances-snaptrade-backfill-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testDbPath, "db");
}

function seedAccount() {
  const account = mapSnapTradeAccountToDomain({
    account: createSnapTradeAccount(),
    providerConnectionId: providerConnectionIdForSnapTrade("auth-fidelity-1"),
    syncedAt: "2026-07-06T12:00:00.000Z"
  });

  if (!account) {
    throw new Error("expected a mapped SnapTrade account");
  }

  return account;
}

function snapshotInput(
  account: ReturnType<typeof seedAccount>,
  balanceSnapshots: Parameters<typeof upsertAccountBalanceSnapshots>[0],
  accounts: ReturnType<typeof seedAccount>[] = [account]
) {
  const providerConnectionId = providerConnectionIdForSnapTrade("auth-fidelity-1");
  return {
    accounts,
    balanceSnapshots,
    errors: [],
    finishedAt: "2026-07-06T12:00:00.000Z",
    positionAccountIds: [],
    positions: [],
    providerConnections: [
      {
        configured: true,
        displayName: "SnapTrade - Fidelity",
        id: providerConnectionId,
        lastSyncedAt: "2026-07-06T12:00:00.000Z",
        provider: "snaptrade" as const,
        status: "connected" as const
      }
    ],
    startedAt: "2026-07-06T12:00:00.000Z",
    successfulProviderConnectionIds: [providerConnectionId]
  };
}

function createSnapTradeAccount(overrides?: { id?: string; totalAmount?: number }): SnapTradeAccount {
  return {
    account_category: "INVESTMENT",
    balance: { total: { amount: overrides?.totalAmount ?? 12345.67, currency: "USD" } },
    brokerage_authorization: "auth-fidelity-1",
    created_date: "2026-07-01T00:00:00.000Z",
    id: overrides?.id ?? "snap-account-1",
    institution_name: "Fidelity",
    is_paper: false,
    name: "Individual Brokerage",
    number: "****6789",
    status: "open",
    sync_status: {
      holdings: {
        initial_sync_completed: true,
        last_successful_sync: "2026-07-06T12:00:00.000Z"
      }
    }
  };
}
