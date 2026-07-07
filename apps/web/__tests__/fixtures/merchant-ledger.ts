import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import type { TellerLedger } from "@/lib/finance-data";

/**
 * A small ledger with three "Starbucks*" transactions (matching a
 * `merchant_or_description contains "Starbucks"` rule) plus one non-matching
 * "Shell Oil" transaction. Shared by the rules-preview and bulk-categorize
 * API tests so both exercise the same matching surface.
 */
export function createMerchantLedger(): TellerLedger {
  const providerConnection = {
    configured: true,
    displayName: "Teller - Test Bank",
    id: "provider_teller_test",
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    provider: "teller",
    status: "connected"
  } satisfies ProviderConnection;
  const account = {
    availableBalance: 900.25,
    currency: "USD",
    currentBalance: 1000.25,
    groupId: "group_cash",
    id: "acct_1",
    includedInNetWorth: true,
    institutionName: "Test Bank",
    lastUpdatedAt: "2026-05-31T00:00:00.000Z",
    name: "Checking",
    providerConnectionId: providerConnection.id,
    type: "checking"
  } satisfies Account;
  const base = {
    accountId: account.id,
    amount: -8.5,
    categoryId: "cat_other",
    currency: "USD",
    date: "2026-05-30",
    description: "STARBUCKS 19628",
    id: "txn_sb1",
    merchantName: "Starbucks 19628",
    postedDate: "2026-05-30",
    providerConnectionId: providerConnection.id,
    reviewed: false,
    status: "posted",
    tags: ["teller"]
  } satisfies Transaction;

  return {
    accounts: [account],
    enrollmentCount: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    providerConnections: [providerConnection],
    source: "teller",
    syncStartDate: "2026-01-01",
    syncSummary: { accountCount: 1, errors: [], transactionCount: 4 },
    transactions: [
      base,
      { ...base, amount: -4.25, date: "2026-05-29", id: "txn_sb2", postedDate: "2026-05-29" },
      {
        ...base,
        amount: -12.75,
        date: "2026-05-28",
        description: "STARBUCKS STORE",
        id: "txn_store",
        merchantName: "STARBUCKS STORE",
        postedDate: "2026-05-28"
      },
      {
        ...base,
        amount: -40,
        date: "2026-05-27",
        description: "SHELL OIL 4471",
        id: "txn_shell",
        merchantName: "Shell Oil 4471",
        postedDate: "2026-05-27"
      }
    ],
    version: 1
  };
}
