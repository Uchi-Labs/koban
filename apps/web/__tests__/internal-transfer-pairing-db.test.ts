// @vitest-environment node

import type { Account, ProviderConnection, Transaction } from "@ai-finances/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeFinanceDbForTests,
  listEnrichmentSuggestions,
  readFinanceDbSnapshot,
  replaceLedgerInDb,
  runInternalTransferPairMatching
} from "@/lib/db/finance-db";
import { getFinanceData } from "@/lib/finance-data";
import type { Ledger } from "@/lib/finance-data";

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

describe("internal transfer pair matching database integration", () => {
  it("records auto-applied pair suggestions and removes matched card credits from income", async () => {
    useTempDb();
    await replaceLedgerInDb(createTransferPairLedger());

    const summary = await runInternalTransferPairMatching();
    const snapshot = await readFinanceDbSnapshot();
    const suggestions = await listEnrichmentSuggestions({ status: "all" });
    const financeData = await getFinanceData();

    expect(summary).toMatchObject({
      autoAppliedPairs: 1,
      autoAppliedSuggestions: 2,
      candidatePairs: 1,
      queuedPairs: 0,
      queuedSuggestions: 0
    });
    expect(snapshot?.transactions.find((transaction) => transaction.id === "txn_checking_payment")).toMatchObject({
      categoryId: "cat_transfer"
    });
    expect(snapshot?.transactions.find((transaction) => transaction.id === "txn_card_payment")).toMatchObject({
      categoryId: "cat_transfer"
    });
    expect(suggestions.filter((suggestion) => suggestion.source === "pair-matcher")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          categoryId: "cat_transfer",
          status: "applied",
          transactionId: "txn_checking_payment"
        }),
        expect.objectContaining({
          categoryId: "cat_transfer",
          status: "applied",
          transactionId: "txn_card_payment"
        })
      ])
    );
    expect(financeData.dashboardSummary.monthlyIncome).toBe(1200);
    expect(financeData.dashboardSummary.monthlySpending).toBe(-40);
  }, 15_000);

  it("hard-links paired counterparts, marks one-sided transfers, and respects user overrides", async () => {
    useTempDb();
    await replaceLedgerInDb(createMixedTransferLedger());

    const summary = await runInternalTransferPairMatching();
    const snapshot = await readFinanceDbSnapshot();
    const suggestions = await listEnrichmentSuggestions({ status: "all" });
    const financeData = await getFinanceData();
    const byId = new Map((snapshot?.transactions ?? []).map((transaction) => [transaction.id, transaction]));

    // Pair matcher: both sides marked transfer AND hard-linked to each other.
    expect(byId.get("txn_pair_checking")).toMatchObject({
      categoryId: "cat_transfer",
      pairedTransactionId: "txn_pair_card"
    });
    expect(byId.get("txn_pair_card")).toMatchObject({
      categoryId: "cat_transfer",
      pairedTransactionId: "txn_pair_checking"
    });
    expect(summary.linkedPairs).toBeGreaterThanOrEqual(1);

    // One-sided vocabulary marks (no connected counterpart): card payment credit,
    // vault move, reward redemption — each ends up cat_transfer with no link.
    for (const id of ["txn_card_onesided", "txn_vault", "txn_reward"]) {
      expect(byId.get(id)?.categoryId, id).toBe("cat_transfer");
      expect(byId.get(id)?.pairedTransactionId, id).toBeUndefined();
    }
    expect(summary.autoAppliedOneSided).toBeGreaterThanOrEqual(3);
    expect(suggestions.filter((suggestion) => suggestion.source === "transfer-heuristic").length).toBeGreaterThanOrEqual(3);

    // Misfire guard: a bare "DISCOVER" purchase debit on a bank account is NOT a
    // transfer — it stays a spend.
    expect(byId.get("txn_discover_purchase")?.categoryId).toBe("cat_other");

    // User override wins: a would-be card-payment credit the user recategorized to
    // shopping is never re-marked (mirrors Copilot's user_changed_type).
    expect(byId.get("txn_user_override")?.categoryId).toBe("cat_shopping");

    // No double counting: the +523.45 card-payment credit and the +34.56 reward are
    // excluded from income (only the 1500 payroll remains); the -1000 pair debit and
    // -717.10 vault move are excluded from spend, leaving grocery (-40), the untouched
    // DISCOVER purchase (-61.20), and the user's shopping override (-85).
    expect(financeData.dashboardSummary.monthlyIncome).toBe(1500);
    expect(financeData.dashboardSummary.monthlySpending).toBe(-186.2);
  }, 15_000);
});

function createMixedTransferLedger(): Ledger {
  const providerConnection = {
    configured: true,
    displayName: "Plaid - Test Bank",
    id: "provider_plaid_test",
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    provider: "plaid",
    status: "connected"
  } satisfies ProviderConnection;
  const checking = account({
    groupId: "group_cash",
    id: "acct_checking",
    name: "Checking",
    providerConnectionId: providerConnection.id,
    type: "checking"
  });
  const savings = account({
    groupId: "group_cash",
    id: "acct_savings",
    name: "Savings",
    providerConnectionId: providerConnection.id,
    type: "savings"
  });
  const card = account({
    groupId: "group_credit",
    id: "acct_card",
    name: "Card",
    providerConnectionId: providerConnection.id,
    type: "credit_card"
  });

  // Credit-card amounts are seeded pre-normalization; the Plaid normalizer
  // negates credit-card signs, so a seeded -X becomes +X (a payment credit).
  const transactions: Transaction[] = [
    // Pair: bank debit ↔ card credit, equal amount, card-payment text on the card.
    transaction({
      accountId: checking.id,
      amount: -1000,
      description: "Payment to Card ending in 1234",
      id: "txn_pair_checking",
      merchantName: "CARD PAYMENT"
    }),
    transaction({
      accountId: card.id,
      amount: -1000,
      description: "Payment Thank You-Mobile",
      id: "txn_pair_card",
      merchantName: "CARD"
    }),
    // One-sided card-payment credit (no bank counterpart connected).
    transaction({
      accountId: card.id,
      amount: -523.45,
      description: "Auto Pay Thank You",
      id: "txn_card_onesided",
      merchantName: "Auto Pay Thank You",
      tags: ["plaid"]
    }),
    // One-sided vault move.
    transaction({
      accountId: savings.id,
      amount: -717.1,
      description: "To Emergency Fund Vault",
      id: "txn_vault",
      merchantName: "To Emergency Fund Vault",
      tags: ["simplefin"]
    }),
    // One-sided reward redemption (bare merchant, redemption in the description).
    transaction({
      accountId: savings.id,
      amount: 34.56,
      description: "SoFi Rewards Redemption",
      id: "txn_reward",
      merchantName: "SoFi"
    }),
    // Misfire guard: bare-issuer purchase debit on a bank account — a real spend.
    transaction({
      accountId: checking.id,
      amount: -61.2,
      description: "DISCOVER PURCHASE",
      id: "txn_discover_purchase",
      merchantName: "DISCOVER"
    }),
    // User override: a would-be vault transfer the user moved to shopping — never
    // re-marked, and still counts as shopping spend.
    transaction({
      accountId: checking.id,
      amount: -85,
      categoryId: "cat_shopping",
      description: "To Emergency Fund Vault",
      id: "txn_user_override",
      merchantName: "To Emergency Fund Vault"
    }),
    // Plain income + spend so dashboard totals are checkable.
    transaction({
      accountId: checking.id,
      amount: 1500,
      categoryId: "cat_income",
      description: "BNYMELLON PAYROLL",
      id: "txn_payroll",
      merchantName: "BNYMELLON"
    }),
    transaction({
      accountId: checking.id,
      amount: -40,
      categoryId: "cat_food",
      description: "GROCER",
      id: "txn_grocery",
      merchantName: "GROCER"
    })
  ];

  return {
    accounts: [checking, savings, card],
    enrollmentCount: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    providerConnections: [providerConnection],
    source: "koban",
    syncStartDate: "2026-01-01",
    syncSummary: {
      accountCount: 3,
      errors: [],
      transactionCount: transactions.length
    },
    transactions,
    version: 1
  };
}

function useTempDb() {
  testDbPath = path.join(mkdtempSync(path.join(tmpdir(), "ai-finances-transfer-pairing-")), "db");
  process.env.AI_FINANCES_PGLITE_DIR = testDbPath;
  process.env.AI_FINANCES_LEDGER_BACKUP_PATH = path.join(path.dirname(testDbPath), "ledger-backup.json");
}

function createTransferPairLedger(): Ledger {
  const providerConnection = {
    configured: true,
    displayName: "Plaid - Test Bank",
    id: "provider_plaid_test",
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    provider: "plaid",
    status: "connected"
  } satisfies ProviderConnection;
  const checking = account({
    groupId: "group_cash",
    id: "acct_checking",
    name: "Checking",
    providerConnectionId: providerConnection.id,
    type: "checking"
  });
  const card = account({
    groupId: "group_credit",
    id: "acct_card",
    name: "Card",
    providerConnectionId: providerConnection.id,
    type: "credit_card"
  });

  return {
    accounts: [checking, card],
    enrollmentCount: 1,
    lastSyncedAt: "2026-05-31T00:00:00.000Z",
    providerConnections: [providerConnection],
    source: "koban",
    syncStartDate: "2026-01-01",
    syncSummary: {
      accountCount: 2,
      errors: [],
      transactionCount: 4
    },
    transactions: [
      transaction({
        accountId: checking.id,
        amount: -1000,
        categoryId: "cat_transfer",
        description: "Payment to Card ending in 1234",
        id: "txn_checking_payment",
        merchantName: "CARD PAYMENT"
      }),
      transaction({
        accountId: card.id,
        amount: -1000,
        description: "Payment Thank You-Mobile",
        id: "txn_card_payment",
        merchantName: "CARD"
      }),
      transaction({
        accountId: checking.id,
        amount: 1200,
        categoryId: "cat_income",
        description: "BNYMELLON PAYROLL",
        id: "txn_payroll",
        merchantName: "BNYMELLON"
      }),
      transaction({
        accountId: checking.id,
        amount: -40,
        categoryId: "cat_food",
        description: "GROCER",
        id: "txn_food",
        merchantName: "GROCER"
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
    lastUpdatedAt: "2026-05-31T00:00:00.000Z",
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
    date: "2026-05-30",
    description: "Transaction",
    id: "txn",
    merchantName: "Merchant",
    postedDate: "2026-05-30",
    providerConnectionId: "provider_plaid_test",
    reviewed: false,
    status: "posted",
    tags: ["plaid"],
    ...input
  };
}
