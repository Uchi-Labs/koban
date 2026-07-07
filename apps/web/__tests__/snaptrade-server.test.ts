// @vitest-environment node

import type {
  Account as SnapTradeAccount,
  AccountPosition
} from "snaptrade-typescript-sdk";
import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeFinanceDbForTests,
  listInvestmentPositions,
  readFinanceDbSnapshot,
  replaceSnapTradeInvestmentSnapshot,
  replaceTellerLedgerInDb
} from "@/lib/db/finance-db";
import type { TellerLedger } from "@/lib/finance-data";
import {
  accountIdForSnapTrade,
  encodeStoredSnapTradeUser,
  mapSnapTradeAccountToDomain,
  mapSnapTradePositionToDomain,
  parseStoredSnapTradeUser,
  providerConnectionIdForSnapTrade
} from "@/lib/snaptrade-server";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  delete process.env.AI_FINANCES_PGLITE_DIR;
});

describe("SnapTrade normalization", () => {
  it("maps a SnapTrade brokerage account to an investment account without storing the full account number", () => {
    const syncedAt = "2026-07-06T12:00:00.000Z";
    const account = mapSnapTradeAccountToDomain({
      account: createSnapTradeAccount(),
      providerConnectionId: providerConnectionIdForSnapTrade("auth-fidelity-1"),
      syncedAt
    });

    expect(account).toEqual({
      id: accountIdForSnapTrade("snap-account-1"),
      providerConnectionId: providerConnectionIdForSnapTrade("auth-fidelity-1"),
      groupId: "group_investments",
      name: "Individual Brokerage",
      institutionName: "Fidelity",
      type: "investment",
      mask: "6789",
      currency: "USD",
      currentBalance: 12345.67,
      includedInNetWorth: true,
      lastUpdatedAt: syncedAt
    });
  });

  it("maps a unified SnapTrade position to the minimal stored holding shape", () => {
    const position = mapSnapTradePositionToDomain({
      accountId: "snaptrade_acct_test",
      position: createSnapTradePosition()
    });

    expect(position).toMatchObject({
      accountId: "snaptrade_acct_test",
      symbol: "AAPL",
      description: "Apple Inc.",
      units: 12.5,
      price: 201.23,
      currency: "USD",
      marketValue: 2515.38
    });
    expect(position?.id).toMatch(/^snaptrade_pos_[0-9a-f]{24}$/);
  });

  it("does not synthesize market value when units or price are missing", () => {
    expect(
      mapSnapTradePositionToDomain({
        accountId: "snaptrade_acct_test",
        position: {
          ...createSnapTradePosition(),
          price: null
        }
      })
    ).toBeNull();
  });

  it("round-trips the stored SnapTrade user secret envelope", () => {
    const encoded = encodeStoredSnapTradeUser({
      registeredAt: "2026-07-06T12:00:00.000Z",
      userId: "ai-finances-test",
      userSecret: "test-user-secret"
    });

    expect(parseStoredSnapTradeUser(encoded)).toEqual({
      registeredAt: "2026-07-06T12:00:00.000Z",
      userId: "ai-finances-test",
      userSecret: "test-user-secret"
    });
    expect(parseStoredSnapTradeUser("not-base64")).toBeUndefined();
  });
});

describe("SnapTrade DB replacement", () => {
  it("adds investment accounts without wiping Teller accounts on future Teller resyncs", async () => {
    useTempDb();
    await replaceTellerLedgerInDb(createTellerLedger(100));

    const providerConnectionId = providerConnectionIdForSnapTrade("auth-fidelity-1");
    const account = mapSnapTradeAccountToDomain({
      account: createSnapTradeAccount(),
      providerConnectionId,
      syncedAt: "2026-07-06T12:00:00.000Z"
    });
    const position = mapSnapTradePositionToDomain({
      accountId: account!.id,
      position: createSnapTradePosition()
    });

    await replaceSnapTradeInvestmentSnapshot({
      accounts: [account!],
      balanceSnapshots: [
        {
          accountId: account!.id,
          asOfDate: "2026-07-06",
          capturedAt: "2026-07-06T12:00:00.000Z",
          currency: "USD",
          id: `${account!.id}_20260706120000000Z`,
          ledgerBalance: account!.currentBalance,
          source: "snaptrade"
        }
      ],
      errors: [],
      finishedAt: "2026-07-06T12:00:00.000Z",
      positionAccountIds: [account!.id],
      positions: [position!],
      providerConnections: [
        {
          configured: true,
          displayName: "SnapTrade - Fidelity",
          id: providerConnectionId,
          lastSyncedAt: "2026-07-06T12:00:00.000Z",
          provider: "snaptrade",
          status: "connected"
        }
      ],
      startedAt: "2026-07-06T12:00:00.000Z",
      successfulProviderConnectionIds: [providerConnectionId]
    });

    await replaceTellerLedgerInDb(createTellerLedger(200));

    const snapshot = await readFinanceDbSnapshot();
    const positions = await listInvestmentPositions();

    expect(snapshot?.accounts.map((candidate) => candidate.id).sort()).toEqual([
      account!.id,
      "teller_acct_test"
    ]);
    expect(snapshot?.accounts.find((candidate) => candidate.id === "teller_acct_test")).toMatchObject({
      currentBalance: 200
    });
    expect(snapshot?.accounts.find((candidate) => candidate.id === account!.id)).toMatchObject({
      currentBalance: 12345.67,
      providerConnectionId
    });
    expect(positions).toEqual([
      expect.objectContaining({
        accountId: account!.id,
        symbol: "AAPL",
        marketValue: 2515.38
      })
    ]);
  }, 15_000);
});

function useTempDb() {
  testDbPath = mkdtempSync(path.join(tmpdir(), "ai-finances-snaptrade-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testDbPath, "db");
}

function createSnapTradeAccount(): SnapTradeAccount {
  return {
    account_category: "INVESTMENT",
    balance: {
      total: {
        amount: 12345.67,
        currency: "USD"
      }
    },
    brokerage_authorization: "auth-fidelity-1",
    created_date: "2026-07-01T00:00:00.000Z",
    id: "snap-account-1",
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

function createSnapTradePosition(): AccountPosition {
  return {
    currency: "USD",
    instrument: {
      currency: "USD",
      description: "Apple Inc.",
      id: "instrument-aapl",
      kind: "stock",
      raw_symbol: "AAPL",
      symbol: "AAPL"
    },
    price: "201.23",
    units: "12.5"
  };
}

function createTellerLedger(balance: number): TellerLedger {
  const providerConnections: ProviderConnection[] = [
    {
      configured: true,
      displayName: "Teller - Test Bank",
      id: "provider_teller_test",
      lastSyncedAt: "2026-07-06T12:00:00.000Z",
      provider: "teller",
      status: "connected"
    }
  ];
  const accounts: Account[] = [
    {
      currency: "USD",
      currentBalance: balance,
      groupId: "group_cash",
      id: "teller_acct_test",
      includedInNetWorth: true,
      institutionName: "Test Bank",
      lastUpdatedAt: "2026-07-06T12:00:00.000Z",
      mask: "1111",
      name: "Checking",
      providerConnectionId: "provider_teller_test",
      type: "checking"
    }
  ];
  const transactions: Transaction[] = [
    {
      accountId: "teller_acct_test",
      amount: -12.34,
      categoryId: "cat_food",
      currency: "USD",
      date: "2026-07-05",
      description: "Coffee",
      id: "txn_test",
      merchantName: "Coffee",
      postedDate: "2026-07-05",
      providerConnectionId: "provider_teller_test",
      reviewed: false,
      status: "posted",
      tags: []
    }
  ];

  return {
    accounts,
    enrollmentCount: 1,
    lastSyncedAt: "2026-07-06T12:00:00.000Z",
    normalization: {
      amountSignConvention: "internal_v1"
    },
    providerConnections,
    source: "teller",
    syncStartDate: "2026-07-01",
    syncSummary: {
      accountCount: accounts.length,
      errors: [],
      transactionCount: transactions.length
    },
    transactions,
    version: 1
  };
}
