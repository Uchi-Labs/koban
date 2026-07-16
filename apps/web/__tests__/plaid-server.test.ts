// @vitest-environment node

import type {
  AccountBase,
  RemovedTransaction,
  Transaction as PlaidTransaction,
  TransactionsUpdateStatus,
  TransactionsSyncRequest,
  TransactionsSyncResponse
} from "plaid";
import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeFinanceDbForTests,
  readFinanceDbSnapshot,
  readSyncStateValue,
  replacePlaidLedgerSnapshot,
  updateDbTransaction
} from "@/lib/db/finance-db";
import {
  accountIdForPlaid,
  encodeStoredPlaidItems,
  mapPlaidAccountToDomain,
  mapPlaidTransactionToDomain,
  parseStoredPlaidItems,
  plaidItemsStateKey,
  providerConnectionIdForPlaid,
  readStoredPlaidItems,
  syncPlaidDataForTests,
  transactionIdForPlaid,
  type PlaidApiClient,
  type StoredPlaidItem
} from "@/lib/plaid-server";

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();
  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }
  vi.restoreAllMocks();
  delete process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.PLAID_CLIENT_ID;
  delete process.env.PLAID_SECRET;
  delete process.env.PLAID_ENV;
  delete process.env.PLAID_ITEMS_B64;
});

describe("Plaid mapping", () => {
  it("maps Plaid accounts and negates transaction amount signs", () => {
    const syncedAt = "2026-07-06T12:00:00.000Z";
    const account = mapPlaidAccountToDomain({
      account: createPlaidAccount({
        accountId: "plaid-card-1",
        current: 431.22,
        name: "Discover Card",
        subtype: "credit card",
        type: "credit"
      }),
      institutionName: "Discover",
      itemId: "item-discover",
      syncedAt
    });
    const transaction = mapPlaidTransactionToDomain({
      account,
      plaidTransaction: createPlaidTransaction({
        accountId: "plaid-card-1",
        amount: 12.5,
        transactionId: "txn-card-purchase"
      }),
      providerConnectionId: providerConnectionIdForPlaid("item-discover")
    });

    expect(account).toMatchObject({
      currentBalance: -431.22,
      groupId: "group_credit",
      id: accountIdForPlaid("plaid-card-1"),
      institutionName: "Discover",
      type: "credit_card"
    });
    expect(transaction).toMatchObject({
      amount: -12.5,
      id: transactionIdForPlaid("txn-card-purchase"),
      status: "posted",
      tags: ["plaid"]
    });
  });

  it("maps depository subtypes into the app account vocabulary", () => {
    const syncedAt = "2026-07-06T12:00:00.000Z";

    expect(
      mapPlaidAccountToDomain({
        account: createPlaidAccount({ accountId: "checking", name: "Checking", subtype: "checking", type: "depository" }),
        institutionName: "SoFi",
        itemId: "item-sofi",
        syncedAt
      }).type
    ).toBe("checking");
    expect(
      mapPlaidAccountToDomain({
        account: createPlaidAccount({ accountId: "savings", name: "Savings", subtype: "savings", type: "depository" }),
        institutionName: "SoFi",
        itemId: "item-sofi",
        syncedAt
      }).type
    ).toBe("savings");
  });
});

describe("Plaid seed and sync", () => {
  it("imports PLAID_ITEMS_B64 into sync_state on first use", async () => {
    useTempDb();
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.PLAID_ITEMS_B64 = Buffer.from(
      JSON.stringify([
        {
          access_token: "access-seed",
          institution_id: "ins_33",
          item_id: "item-seed"
        }
      ]),
      "utf8"
    ).toString("base64");

    const items = await readStoredPlaidItems();
    const stored = parseStoredPlaidItems(await readSyncStateValue(plaidItemsStateKey));

    expect(items).toEqual([
      expect.objectContaining({
        accessToken: "access-seed",
        institutionId: "ins_33",
        institutionName: "Discover",
        itemId: "item-seed"
      })
    ]);
    expect(stored.map((item) => item.itemId)).toEqual(["item-seed"]);
  }, 15_000);

  it("assembles paginated /transactions/sync responses and persists the final cursor", async () => {
    useTempDb();
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.PLAID_CLIENT_ID = "client-id";
    process.env.PLAID_SECRET = "secret";
    process.env.PLAID_ENV = "production";
    process.env.PLAID_ITEMS_B64 = Buffer.from(
      JSON.stringify([
        {
          access_token: "access-sofi",
          institution_id: "ins_126339",
          item_id: "item-sofi"
        }
      ]),
      "utf8"
    ).toString("base64");
    const calls: TransactionsSyncRequest[] = [];
    const client = createFakePlaidClient(async (request) => {
      calls.push(request);

      if (!request.cursor) {
        return createSyncResponse({
          accounts: [createPlaidAccount({ accountId: "acct-sofi", current: 1200, name: "Checking", subtype: "checking", type: "depository" })],
          added: [
            createPlaidTransaction({
              accountId: "acct-sofi",
              amount: -100,
              merchantName: "Payroll",
              name: "PAYROLL",
              transactionId: "txn-payroll"
            })
          ],
          hasMore: true,
          nextCursor: "cursor-1"
        });
      }

      return createSyncResponse({
        accounts: [createPlaidAccount({ accountId: "acct-sofi", current: 1300, name: "Checking", subtype: "checking", type: "depository" })],
        added: [
          createPlaidTransaction({
            accountId: "acct-sofi",
            amount: 24.75,
            merchantName: "Coffee Shop",
            name: "COFFEE SHOP",
            transactionId: "txn-coffee"
          })
        ],
        hasMore: false,
        nextCursor: "cursor-2",
        removed: [{ account_id: "acct-sofi", transaction_id: "txn-old" }]
      });
    });

    const result = await syncPlaidDataForTests(client);
    const stored = parseStoredPlaidItems(await readSyncStateValue(plaidItemsStateKey));
    const snapshot = await readFinanceDbSnapshot();

    expect(calls).toEqual([
      expect.objectContaining({ count: 500, cursor: undefined }),
      expect.objectContaining({ count: 500, cursor: "cursor-1" })
    ]);
    expect(result).toMatchObject({
      accountCount: 1,
      ok: true,
      removedTransactionCount: 1,
      transactionCount: 2
    });
    expect(stored[0]).toMatchObject({ itemId: "item-sofi", nextCursor: "cursor-2" });
    expect(snapshot?.transactions.map((transaction) => transaction.id).sort()).toEqual([
      transactionIdForPlaid("txn-coffee"),
      transactionIdForPlaid("txn-payroll")
    ]);
  }, 15_000);
});

describe("Plaid persistence", () => {
  it("replaces a pending transaction with the posted transaction while preserving user overlays", async () => {
    useTempDb();
    const account = createDomainPlaidAccount();
    const pending = createDomainPlaidTransaction(account, {
      pending: true,
      transactionId: "txn-pending"
    });

    await persistPlaidSnapshot({
      accounts: [account],
      transactions: [pending]
    });
    await updateDbTransaction(pending.id, {
      categoryId: "cat_shopping",
      notes: "Reviewed while pending.",
      reviewed: true,
      tags: ["manual", "watch"]
    });

    const posted = createDomainPlaidTransaction(account, {
      pending: false,
      pendingTransactionId: "txn-pending",
      transactionId: "txn-posted"
    });

    await persistPlaidSnapshot({
      accounts: [account],
      transactions: [posted]
    });

    const snapshot = await readFinanceDbSnapshot();
    const pendingRow = snapshot?.transactions.find((transaction) => transaction.id === pending.id);
    const postedRow = snapshot?.transactions.find((transaction) => transaction.id === posted.id);

    expect(pendingRow).toBeUndefined();
    expect(postedRow).toMatchObject({
      categoryId: "cat_shopping",
      notes: "Reviewed while pending.",
      pendingTransactionId: pending.id,
      reviewed: true,
      tags: ["manual", "watch"]
    });
  }, 15_000);

  it("deletes removed Plaid transactions without touching unrelated overlays", async () => {
    useTempDb();
    const account = createDomainPlaidAccount();
    const removed = createDomainPlaidTransaction(account, { transactionId: "txn-removed" });
    const kept = createDomainPlaidTransaction(account, { transactionId: "txn-kept" });

    await persistPlaidSnapshot({
      accounts: [account],
      transactions: [removed, kept]
    });
    await updateDbTransaction(kept.id, {
      categoryId: "cat_food",
      notes: "Keep this overlay.",
      reviewed: true,
      tags: ["manual"]
    });
    await persistPlaidSnapshot({
      accounts: [account],
      removedTransactionIds: [removed.id],
      transactions: []
    });

    const snapshot = await readFinanceDbSnapshot();

    expect(snapshot?.transactions.find((transaction) => transaction.id === removed.id)).toBeUndefined();
    expect(snapshot?.transactions.find((transaction) => transaction.id === kept.id)).toMatchObject({
      categoryId: "cat_food",
      notes: "Keep this overlay.",
      reviewed: true,
      tags: ["manual"]
    });
  }, 15_000);

  it("marks stored Plaid accounts inactive when the item errors", async () => {
    useTempDb();
    const account = createDomainPlaidAccount();

    await persistPlaidSnapshot({
      accounts: [account],
      transactions: []
    });
    await replacePlaidLedgerSnapshot({
      accounts: [],
      balanceSnapshots: [],
      errors: ["Discover: Plaid API returned HTTP 400."],
      finishedAt: "2026-07-06T13:00:00.000Z",
      providerConnections: [
        {
          configured: true,
          displayName: "Plaid - Discover",
          errorMessage: "Discover: Plaid API returned HTTP 400.",
          id: providerConnectionIdForPlaid("item-discover"),
          lastSyncedAt: "2026-07-06T12:00:00.000Z",
          provider: "plaid",
          status: "error"
        }
      ],
      removedTransactionIds: [],
      startedAt: "2026-07-06T13:00:00.000Z",
      successfulProviderConnectionIds: [],
      syncState: {
        [plaidItemsStateKey]: encodeStoredPlaidItems([
          {
            accessToken: "access-token",
            errorMessage: "Discover: Plaid API returned HTTP 400.",
            institutionId: "ins_33",
            institutionName: "Discover",
            itemId: "item-discover",
            linkedAt: "2026-07-06T12:00:00.000Z",
            nextCursor: "cursor"
          }
        ])
      },
      transactions: []
    });

    const snapshot = await readFinanceDbSnapshot();

    expect(snapshot?.accounts.find((candidate) => candidate.id === account.id)).toMatchObject({
      includedInNetWorth: false
    });
  }, 15_000);
});

function useTempDb() {
  testDbPath = mkdtempSync(path.join(tmpdir(), "ai-finances-plaid-"));
  process.env.AI_FINANCES_PGLITE_DIR = path.join(testDbPath, "db");
}

function createFakePlaidClient(
  transactionsSync: (request: TransactionsSyncRequest) => Promise<TransactionsSyncResponse>
): PlaidApiClient {
  return {
    async institutionsGetById() {
      throw new Error("not used");
    },
    async itemPublicTokenExchange() {
      throw new Error("not used");
    },
    async linkTokenCreate() {
      throw new Error("not used");
    },
    async transactionsSync(request) {
      return { data: await transactionsSync(request) };
    }
  };
}

function createSyncResponse({
  accounts,
  added = [],
  hasMore,
  modified = [],
  nextCursor,
  removed = []
}: {
  accounts: AccountBase[];
  added?: PlaidTransaction[];
  hasMore: boolean;
  modified?: PlaidTransaction[];
  nextCursor: string;
  removed?: RemovedTransaction[];
}): TransactionsSyncResponse {
  return {
    accounts,
    added,
    has_more: hasMore,
    modified,
    next_cursor: nextCursor,
    removed,
    request_id: `request-${nextCursor}`,
    transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" as TransactionsUpdateStatus
  };
}

function createPlaidAccount({
  accountId,
  current = 100,
  name,
  subtype,
  type
}: {
  accountId: string;
  current?: number;
  name: string;
  subtype: string;
  type: string;
}): AccountBase {
  return {
    account_id: accountId,
    balances: {
      available: current,
      current,
      iso_currency_code: "USD",
      limit: null,
      unofficial_currency_code: null
    },
    mask: "1234",
    name,
    official_name: name,
    subtype,
    type
  } as AccountBase;
}

function createPlaidTransaction({
  accountId,
  amount = 12.5,
  merchantName = "Card Merchant",
  name = "CARD MERCHANT",
  pending = false,
  pendingTransactionId,
  transactionId
}: {
  accountId: string;
  amount?: number;
  merchantName?: string;
  name?: string;
  pending?: boolean;
  pendingTransactionId?: string;
  transactionId: string;
}): PlaidTransaction {
  return {
    account_id: accountId,
    amount,
    authorized_date: pending ? "2026-07-04" : null,
    date: "2026-07-05",
    iso_currency_code: "USD",
    merchant_name: merchantName,
    name,
    pending,
    pending_transaction_id: pendingTransactionId ?? null,
    transaction_id: transactionId,
    unofficial_currency_code: null
  } as PlaidTransaction;
}

function createDomainPlaidAccount(): Account {
  return mapPlaidAccountToDomain({
    account: createPlaidAccount({
      accountId: "acct-card",
      current: 500,
      name: "Discover Card",
      subtype: "credit card",
      type: "credit"
    }),
    institutionName: "Discover",
    itemId: "item-discover",
    syncedAt: "2026-07-06T12:00:00.000Z"
  });
}

function createDomainPlaidTransaction(
  account: Account,
  input: {
    pending?: boolean;
    pendingTransactionId?: string;
    transactionId: string;
  }
): Transaction {
  return mapPlaidTransactionToDomain({
    account,
    plaidTransaction: createPlaidTransaction({
      accountId: "acct-card",
      amount: 12.5,
      pending: input.pending ?? false,
      pendingTransactionId: input.pendingTransactionId,
      transactionId: input.transactionId
    }),
    providerConnectionId: providerConnectionIdForPlaid("item-discover")
  });
}

async function persistPlaidSnapshot({
  accounts,
  removedTransactionIds = [],
  transactions
}: {
  accounts: Account[];
  removedTransactionIds?: string[];
  transactions: Transaction[];
}) {
  const providerConnection: ProviderConnection = {
    configured: true,
    displayName: "Plaid - Discover",
    id: providerConnectionIdForPlaid("item-discover"),
    lastSyncedAt: "2026-07-06T12:00:00.000Z",
    provider: "plaid",
    status: "connected"
  };
  const item: StoredPlaidItem = {
    accessToken: "access-token",
    institutionId: "ins_33",
    institutionName: "Discover",
    itemId: "item-discover",
    linkedAt: "2026-07-06T12:00:00.000Z",
    nextCursor: "cursor"
  };

  await replacePlaidLedgerSnapshot({
    accounts,
    balanceSnapshots: accounts.map((account) => ({
      accountId: account.id,
      asOfDate: "2026-07-06",
      capturedAt: "2026-07-06T12:00:00.000Z",
      currency: account.currency,
      id: `${account.id}_20260706120000000Z`,
      ledgerBalance: account.currentBalance,
      source: "koban"
    })),
    errors: [],
    finishedAt: "2026-07-06T12:00:00.000Z",
    providerConnections: [providerConnection],
    removedTransactionIds,
    startedAt: "2026-07-06T12:00:00.000Z",
    successfulProviderConnectionIds: [providerConnection.id],
    syncState: {
      [plaidItemsStateKey]: encodeStoredPlaidItems([item])
    },
    transactions
  });
}
