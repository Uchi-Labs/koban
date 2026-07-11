import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyPlan,
  buildTransactionTags,
  findDuplicateTransaction,
  matchCopilotAccount,
  normalizeBalanceMinor,
  toMinor
} from "./import.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(testDir, "../../apps/web/package.json"));
const { PGlite } = require("@electric-sql/pglite");

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
  assert.equal(normalizeBalanceMinor(3132.69, "checking"), 313269);
});

test("applies atomically and preserves Koban transaction overlays on an idempotent rerun", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE provider_connections (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL,
      configured BOOLEAN NOT NULL, last_synced_at TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id),
      group_id TEXT NOT NULL, name TEXT NOT NULL, institution_name TEXT NOT NULL, type TEXT NOT NULL,
      mask TEXT, currency TEXT NOT NULL, current_balance_minor INTEGER NOT NULL,
      available_balance_minor INTEGER, included_in_net_worth BOOLEAN NOT NULL, last_updated_at TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE account_balance_snapshots (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), as_of_date TEXT NOT NULL,
      captured_at TEXT NOT NULL, ledger_balance_minor INTEGER NOT NULL, available_balance_minor INTEGER,
      currency TEXT NOT NULL, source TEXT NOT NULL
    );
    CREATE TABLE tag_registry (
      name TEXT PRIMARY KEY, color TEXT, kind TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id), date TEXT NOT NULL,
      posted_date TEXT, merchant_name TEXT NOT NULL, description TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL, category_id TEXT NOT NULL, status TEXT NOT NULL, reviewed BOOLEAN NOT NULL,
      tags JSONB NOT NULL, notes TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  const pool = {
    async connect() {
      return {
        query: (sql, params) => db.query(sql, params),
        release() {}
      };
    }
  };
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

  await applyPlan(pool, plan);
  await db.query(
    `UPDATE transactions SET category_id = 'cat_food', reviewed = TRUE, tags = '["favorite"]'::jsonb, notes = 'Koban edit' WHERE id = 'copilot_txn_old'`
  );
  await applyPlan(pool, plan);

  const transaction = (await db.query("SELECT category_id, reviewed, tags, notes FROM transactions WHERE id = 'copilot_txn_old'"))
    .rows[0];
  const account = (await db.query("SELECT included_in_net_worth FROM accounts WHERE id = 'copilot_acct_old'")).rows[0];
  const tag = (await db.query("SELECT kind FROM tag_registry WHERE name = 'copilot:cat:Restaurants'")).rows[0];
  assert.deepEqual(transaction, { category_id: "cat_food", reviewed: true, tags: ["favorite"], notes: "Koban edit" });
  assert.equal(account.included_in_net_worth, false);
  assert.equal(tag.kind, "source");
  await db.close();
});
