// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeFinanceDbForTests,
  readFinanceDbSnapshot,
  remapOverlayPairsAcrossPendingPosted,
  replaceLedgerInDb,
  replacePlaidLedgerSnapshot,
  type TransactionOverlayRow
} from "@/lib/db/finance-db";
import type { Ledger } from "@/lib/finance-data";

/**
 * Regression cover for the Plaid sync freeze of 2026-08-01.
 *
 * A $60 internal transfer left two mutually paired *pending* transactions. When
 * both posted in one Plaid batch, ingest deleted the pending rows and then wrote
 * their now-dead ids straight back from an overlay snapshot taken before BEGIN,
 * tripping `transactions_paired_transaction_fk` and rolling back every sync for
 * ten days.
 */

let testDbPath: string | null = null;

afterEach(async () => {
  await closeFinanceDbForTests();

  if (testDbPath) {
    rmSync(testDbPath, { force: true, recursive: true });
    testDbPath = null;
  }

  delete process.env.AI_FINANCES_PGLITE_DIR;
  delete process.env.AI_FINANCES_LEDGER_BACKUP_PATH;
});

describe("remapOverlayPairsAcrossPendingPosted", () => {
  it("repoints a mutually paired pending couple at their posted replacements", () => {
    const overlays = overlayMap([
      overlay({ id: "pending_a", paired_transaction_id: "pending_b" }),
      overlay({ id: "pending_b", paired_transaction_id: "pending_a" })
    ]);

    const remapped = remapOverlayPairsAcrossPendingPosted(overlays, [
      { id: "posted_a", pendingTransactionId: "pending_a" },
      { id: "posted_b", pendingTransactionId: "pending_b" }
    ]);

    expect(remapped.get("pending_a")?.paired_transaction_id).toBe("posted_b");
    expect(remapped.get("pending_b")?.paired_transaction_id).toBe("posted_a");
  });

  it("leaves pairs pointing at rows that are not being replaced untouched", () => {
    const overlays = overlayMap([
      overlay({ id: "posted_a", paired_transaction_id: "posted_b" }),
      overlay({ id: "posted_b", paired_transaction_id: "posted_a" })
    ]);

    const remapped = remapOverlayPairsAcrossPendingPosted(overlays, [
      { id: "posted_c", pendingTransactionId: "pending_c" }
    ]);

    expect(remapped.get("posted_a")?.paired_transaction_id).toBe("posted_b");
    expect(remapped.get("posted_b")?.paired_transaction_id).toBe("posted_a");
  });

  it("drops a pair that would become a self-reference after the rename", () => {
    const overlays = overlayMap([overlay({ id: "posted_a", paired_transaction_id: "pending_a" })]);

    const remapped = remapOverlayPairsAcrossPendingPosted(overlays, [
      { id: "posted_a", pendingTransactionId: "pending_a" }
    ]);

    expect(remapped.get("posted_a")?.paired_transaction_id).toBeNull();
  });

  it("returns the original map and mutates nothing when no transaction is being replaced", () => {
    const overlays = overlayMap([overlay({ id: "posted_a", paired_transaction_id: "posted_b" })]);

    const remapped = remapOverlayPairsAcrossPendingPosted(overlays, [{ id: "posted_a" }]);

    expect(remapped).toBe(overlays);
    expect(overlays.get("posted_a")?.paired_transaction_id).toBe("posted_b");
  });
});

describe("plaid ingest when a paired pending couple posts in one batch", () => {
  it("keeps the hard link intact and leaves no dangling pair behind", async () => {
    useTempDb();
    await replaceLedgerInDb(pendingPairLedger());

    const before = await readFinanceDbSnapshot();
    expect(before?.transactions.find((row) => row.id === "plaid_txn_pending_from")).toMatchObject({
      pairedTransactionId: "plaid_txn_pending_to",
      status: "pending"
    });
    expect(before?.transactions.find((row) => row.id === "plaid_txn_pending_to")).toMatchObject({
      pairedTransactionId: "plaid_txn_pending_from",
      status: "pending"
    });

    await replacePlaidLedgerSnapshot({
      accounts: pendingPairLedger().accounts,
      balanceSnapshots: [],
      errors: [],
      finishedAt: "2026-08-10T22:47:07.425Z",
      providerConnections: pendingPairLedger().providerConnections,
      removedTransactionIds: [],
      startedAt: "2026-08-10T22:47:00.000Z",
      successfulProviderConnectionIds: ["provider_plaid_test"],
      syncState: {},
      transactions: [
        transaction({
          accountId: "acct_checking",
          amount: 60,
          categoryId: "cat_transfer",
          date: "2026-07-30",
          description: "ONLINE TRANSFER FROM CHK ...9341",
          id: "plaid_txn_posted_from",
          pendingTransactionId: "plaid_txn_pending_from",
          status: "posted"
        }),
        transaction({
          accountId: "acct_savings",
          amount: -60,
          categoryId: "cat_transfer",
          date: "2026-07-30",
          description: "ONLINE TRANSFER TO SAV ...7531",
          id: "plaid_txn_posted_to",
          pendingTransactionId: "plaid_txn_pending_to",
          status: "posted"
        })
      ]
    });

    const after = await readFinanceDbSnapshot();
    const ids = new Set(after?.transactions.map((row) => row.id));

    // The pending rows were replaced, not orphaned.
    expect(ids.has("plaid_txn_pending_from")).toBe(false);
    expect(ids.has("plaid_txn_pending_to")).toBe(false);

    // The user's confirmed pair followed the rename instead of being severed.
    expect(after?.transactions.find((row) => row.id === "plaid_txn_posted_from")).toMatchObject({
      pairedTransactionId: "plaid_txn_posted_to"
    });
    expect(after?.transactions.find((row) => row.id === "plaid_txn_posted_to")).toMatchObject({
      pairedTransactionId: "plaid_txn_posted_from"
    });

    // Nothing points at a row that no longer exists.
    const dangling = (after?.transactions ?? []).filter(
      (row) => row.pairedTransactionId !== undefined && !ids.has(row.pairedTransactionId)
    );
    expect(dangling).toEqual([]);
  });
});

function overlay(input: Partial<TransactionOverlayRow> & { id: string }): TransactionOverlayRow {
  return {
    category_id: "cat_transfer",
    financial_goal_id: null,
    notes: null,
    paired_transaction_id: null,
    reviewed: false,
    tags: ["plaid"],
    ...input
  };
}

function overlayMap(rows: TransactionOverlayRow[]): Map<string, TransactionOverlayRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

function pendingPairLedger(): Ledger {
  const providerConnection = {
    configured: true,
    displayName: "Plaid - Test Bank",
    id: "provider_plaid_test",
    lastSyncedAt: "2026-07-30T00:00:00.000Z",
    provider: "plaid",
    status: "connected"
  } satisfies ProviderConnection;

  return {
    accounts: [
      account({ id: "acct_checking", name: "Checking", type: "checking" }),
      account({ groupId: "group_cash", id: "acct_savings", name: "Savings", type: "savings" })
    ],
    enrollmentCount: 1,
    lastSyncedAt: "2026-07-30T00:00:00.000Z",
    providerConnections: [providerConnection],
    source: "koban",
    syncStartDate: "2026-01-01",
    syncSummary: {
      accountCount: 2,
      errors: [],
      transactionCount: 2
    },
    transactions: [
      transaction({
        accountId: "acct_checking",
        amount: 60,
        categoryId: "cat_transfer",
        date: "2026-07-30",
        description: "ONLINE TRANSFER FROM CHK ...9341",
        id: "plaid_txn_pending_from",
        pairedTransactionId: "plaid_txn_pending_to",
        status: "pending"
      }),
      transaction({
        accountId: "acct_savings",
        amount: -60,
        categoryId: "cat_transfer",
        date: "2026-07-30",
        description: "ONLINE TRANSFER TO SAV ...7531",
        id: "plaid_txn_pending_to",
        pairedTransactionId: "plaid_txn_pending_from",
        status: "pending"
      })
    ],
    version: 1
  };
}

function account(input: Partial<Account>): Account {
  return {
    availableBalance: 900,
    currency: "USD",
    currentBalance: 1000,
    groupId: "group_cash",
    id: "acct",
    includedInNetWorth: true,
    institutionName: "Test Bank",
    lastUpdatedAt: "2026-07-30T00:00:00.000Z",
    mask: "1234",
    name: "Account",
    providerConnectionId: "provider_plaid_test",
    type: "checking",
    ...input
  };
}

function transaction(input: Partial<Transaction>): Transaction {
  return {
    accountId: "acct_checking",
    amount: -100,
    categoryId: "cat_other",
    currency: "USD",
    date: "2026-07-30",
    description: "Transaction",
    id: "txn",
    merchantName: "Merchant",
    postedDate: "2026-07-30",
    providerConnectionId: "provider_plaid_test",
    reviewed: false,
    status: "posted",
    tags: ["plaid"],
    ...input
  };
}

function useTempDb() {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-pair-pending-posted-")), "db");
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_LEDGER_BACKUP_PATH = path.join(path.dirname(testDbPath), "ledger-backup.json");
}
