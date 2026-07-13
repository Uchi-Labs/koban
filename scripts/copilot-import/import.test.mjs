import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlan,
  buildImportPlan,
  buildTransactionTags,
  findDuplicateTransaction,
  findMerchantSignEvidence,
  formatDryRunReport,
  loadFinanceDbCopilotImporter,
  matchCopilotAccount,
  normalizeBalanceMinor,
  toMinor
} from "./import.mjs";

test("matches an account by mask plus fuzzy account and institution names", () => {
  const result = matchCopilotAccount(
    {
      id: "copilot_amex",
      institutionName: "American Express",
      mask: "1006",
      name: "Platinum Card",
      officialName: "Platinum Card",
      subtype: "credit card",
      type: "credit"
    },
    [
      {
        id: "koban_amex",
        institution_name: "American Express",
        mask: "1006",
        name: "Platinum Card®",
        provider_connection_id: "provider_plaid_amex",
        type: "credit_card"
      }
    ]
  );

  assert.equal(result.status, "matched");
  assert.equal(result.account.id, "koban_amex");
});

test("does not silently choose between equally plausible duplicate masks", () => {
  const source = {
    id: "copilot_chase",
    institutionName: "Chase",
    mask: "1234",
    name: "Credit Card",
    officialName: "Credit Card",
    subtype: "credit card",
    type: "credit"
  };
  const result = matchCopilotAccount(source, [
    {
      id: "koban_chase_1",
      institution_name: "Chase",
      mask: "1234",
      name: "Credit Card",
      provider_connection_id: "provider_plaid_chase",
      type: "credit_card"
    },
    {
      id: "koban_chase_2",
      institution_name: "Chase",
      mask: "1234",
      name: "Credit Card",
      provider_connection_id: "provider_plaid_chase",
      type: "credit_card"
    }
  ]);

  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["koban_chase_1", "koban_chase_2"]);
});

test("dedupes a negated Copilot amount on the same account within two days", () => {
  const copilotTransaction = {
    amount: 12.34,
    date: "2026-07-10 04:00:00.000"
  };
  const existing = [
    { amount_minor: -1234, date: "2026-07-08", id: "plaid_txn_match" },
    { amount_minor: -1234, date: "2026-07-07", id: "plaid_txn_too_old" }
  ];

  assert.equal(findDuplicateTransaction(copilotTransaction, existing)?.id, "plaid_txn_match");
  assert.equal(toMinor(-copilotTransaction.amount), -1234);
});

test("uses merchant identity in both systems for sign evidence", () => {
  const evidence = findMerchantSignEvidence([
    {
      source: { name: "STARBUCKS" },
      target: { description: "Starbucks", merchant_name: "Starbucks" }
    },
    {
      source: { name: "UNRELATED" },
      target: { description: "Different merchant", merchant_name: "Different merchant" }
    }
  ]);

  assert.equal(evidence.source.name, "STARBUCKS");
  assert.ok(evidence.merchantScore >= 0.55);
});

test("builds source-only provenance tags from category, user tags, and Amazon", () => {
  const tags = buildTransactionTags(
    {
      category_id: "cat_restaurants",
      is_amazon: 1,
      tag_ids: '["tag_sapiex"]'
    },
    {
      categories: { cat_restaurants: { name: "Restaurants" } },
      tags: { tag_sapiex: { name: "Sapiex" } }
    }
  );

  assert.deepEqual(tags, ["copilot:cat:Restaurants", "copilot:tag:Sapiex", "copilot:amazon"]);
});

test("normalizes credit debt balances to negative and leaves assets positive", () => {
  assert.equal(normalizeBalanceMinor(3132.69, "credit_card"), -313269);
  assert.equal(normalizeBalanceMinor(-42.5, "credit_card"), 4250);
  assert.equal(normalizeBalanceMinor(3132.69, "checking"), 313269);
});

test("delegates an approved plan to the finance-db import boundary", async () => {
  let persisted;
  const plan = {
    blockingIssues: [],
    newAccounts: [
      {
        id: "copilot_acct_old",
        provider_connection_id: "provider_copilot_import",
        group_id: "group_credit",
        name: "Old Card",
        institution_name: "Old Bank",
        type: "credit_card",
        mask: "1234",
        currency: "USD",
        current_balance_minor: -5000,
        available_balance_minor: 10000,
        last_updated_at: "2026-07-10T00:00:00.000Z"
      }
    ],
    snapshots: [
      {
        id: "copilot_bal_old_2026-07-10",
        accountId: "copilot_acct_old",
        asOfDate: "2026-07-10",
        capturedAt: "2026-07-10T00:00:00.000Z",
        ledgerBalanceMinor: -5000,
        availableBalanceMinor: 10000,
        currency: "USD",
        source: "copilot"
      }
    ],
    importTransactions: [
      {
        id: "copilot_txn_old",
        sourceId: "old",
        accountId: "copilot_acct_old",
        providerConnectionId: "provider_copilot_import",
        date: "2026-07-10",
        merchantName: "Dinner",
        description: "DINNER",
        amountMinor: -2500,
        currency: "USD",
        tags: ["copilot:cat:Restaurants"],
        notes: "Copilot note"
      }
    ]
  };

  await applyPlan(plan, async (input) => {
    persisted = input;
  });

  assert.equal(persisted.providerConnection.provider, "copilot");
  assert.deepEqual(persisted.accounts[0], {
    id: "copilot_acct_old",
    providerConnectionId: "provider_copilot_import",
    groupId: "group_credit",
    name: "Old Card",
    institutionName: "Old Bank",
    type: "credit_card",
    mask: "1234",
    currency: "USD",
    currentBalance: -50,
    availableBalance: 100,
    includedInNetWorth: false,
    lastUpdatedAt: "2026-07-10T00:00:00.000Z"
  });
  assert.deepEqual(persisted.transactions[0], {
    id: "copilot_txn_old",
    accountId: "copilot_acct_old",
    providerConnectionId: "provider_copilot_import",
    date: "2026-07-10",
    postedDate: "2026-07-10",
    merchantName: "Dinner",
    description: "DINNER",
    amount: -25,
    currency: "USD",
    categoryId: "cat_other",
    status: "posted",
    reviewed: false,
    tags: ["copilot:cat:Restaurants"],
    notes: "Copilot note"
  });
});

test("loads the app finance-db import boundary without opening a database", async () => {
  const loaded = await loadFinanceDbCopilotImporter();
  assert.equal(typeof loaded.apply, "function");
  await loaded.close();
});

test("blocks apply when source currency and an unmatched account balance are absent", () => {
  const plan = buildImportPlan({
    balances: [],
    existingAccounts: [],
    existingSnapshots: [],
    existingTransactions: [],
    mappings: {
      accounts: {
        apple: {
          id: "apple",
          institutionName: "Apple Wallet",
          name: "Apple Card",
          originalSubtype: "credit card",
          originalType: "credit"
        }
      },
      categories: { dining: { id: "dining", name: "Restaurants" } },
      tags: {}
    },
    sourceStats: { deletedCount: 0, pendingCount: 0 },
    transactions: [
      {
        account_id: "apple",
        amount: 25,
        category_id: "dining",
        date: "2026-07-10",
        id: "apple_txn",
        iso_currency_code: null,
        is_amazon: 0,
        name: "Dinner",
        original_name: "DINNER",
        tag_ids: null
      }
    ]
  });

  assert.ok(plan.blockingIssues.includes("1 transaction(s) without source currency"));
  assert.ok(plan.blockingIssues.includes("1 new account(s) without accountDailyBalance history"));
});

test("falls back from malformed transaction currency and reports a dry-run warning", () => {
  const plan = buildImportPlan({
    balances: [],
    existingAccounts: [{
      id: "koban_checking",
      institution_name: "Example Bank",
      mask: "1234",
      name: "Everyday Checking",
      provider: "plaid",
      provider_connection_id: "provider_plaid",
      type: "checking"
    }],
    existingSnapshots: [],
    existingTransactions: [],
    mappings: {
      accounts: {
        checking: {
          id: "checking",
          institutionName: "Example Bank",
          mask: "1234",
          name: "Everyday Checking",
          originalSubtype: "checking",
          originalType: "depository"
        }
      },
      categories: {},
      tags: {}
    },
    overrides: {
      defaultCurrency: "USD",
      forcedMatches: { checking: "koban_checking" }
    },
    sourceStats: { deletedCount: 0, pendingCount: 0 },
    transactions: [{
      account_id: "checking",
      amount: 12.34,
      category_id: null,
      date: "2026-07-10",
      id: "bad_currency",
      iso_currency_code: "usdollars",
      is_amazon: 0,
      name: "Lunch",
      original_name: "LUNCH",
      tag_ids: null
    }]
  });

  assert.equal(plan.importTransactions[0].currency, "USD");
  assert.deepEqual(plan.invalidTransactionCurrencyIds, ["bad_currency"]);
  assert.match(formatDryRunReport(plan), /Malformed source currency rows: 1/);
});

test("consumes each existing duplicate target once and imports extra Copilot candidates", () => {
  const sourceTransaction = (id, date) => ({
    account_id: "checking",
    amount: 12.34,
    category_id: null,
    date,
    id,
    iso_currency_code: "USD",
    is_amazon: 0,
    name: "Lunch",
    original_name: "LUNCH",
    tag_ids: null
  });
  const plan = buildImportPlan({
    balances: [],
    existingAccounts: [{
      id: "koban_checking",
      institution_name: "Example Bank",
      mask: "1234",
      name: "Everyday Checking",
      provider: "plaid",
      provider_connection_id: "provider_plaid",
      type: "checking"
    }],
    existingSnapshots: [],
    existingTransactions: [{
      account_id: "koban_checking",
      amount_minor: -1234,
      date: "2026-07-10",
      description: "LUNCH",
      id: "plaid_lunch",
      merchant_name: "Lunch"
    }],
    mappings: {
      accounts: {
        checking: {
          id: "checking",
          institutionName: "Example Bank",
          mask: "1234",
          name: "Everyday Checking",
          originalSubtype: "checking",
          originalType: "depository"
        }
      },
      categories: {},
      tags: {}
    },
    overrides: {
      forcedMatches: { checking: "koban_checking" }
    },
    sourceStats: { deletedCount: 0, pendingCount: 0 },
    transactions: [
      sourceTransaction("copilot_lunch_1", "2026-07-09"),
      sourceTransaction("copilot_lunch_2", "2026-07-10"),
      sourceTransaction("copilot_lunch_3", "2026-07-11")
    ]
  });

  assert.equal(plan.duplicates.length, 1);
  assert.deepEqual(plan.importTransactions.map((transaction) => transaction.sourceId), [
    "copilot_lunch_2",
    "copilot_lunch_3"
  ]);
  assert.equal(plan.duplicateTargetReuseWarnings.length, 2);
  assert.match(formatDryRunReport(plan), /WARNING: 2 additional Copilot rows matched an already-consumed Koban transaction/);
});
