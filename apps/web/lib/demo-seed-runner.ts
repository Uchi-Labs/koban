// Seeds an explicitly named, dedicated demo PostgreSQL database with the
// synthetic ledger from demo-seed.ts. Shared by `pnpm demo:seed` and the public
// demo server's daily reseed (KOBAN_PUBLIC_DEMO=1).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import {
  assertDemoDataset,
  assertDemoDatabasePreflight,
  assertDemoSeedTarget,
  createDemoDataset,
  demoRecurringRange,
  demoRuleMatchCount,
  demoSeedMarker,
  demoUser
} from "@/lib/demo-seed";

export interface DemoSeedOptions {
  asOfDate?: string;
  confirmation?: string;
  demoDatabaseUrl?: string;
  // The CLI owns its process and closes the finance DB afterwards; the demo
  // server keeps serving from the same connection.
  closeFinanceDb?: boolean;
  workspaceDatabaseUrl?: string;
}

export interface DemoSeedResult {
  asOfDate?: string;
  counts: SeedCounts;
  recurringCount: number;
}

export async function runDemoSeed(options: DemoSeedOptions): Promise<DemoSeedResult> {
  const demoDatabaseUrl = options.demoDatabaseUrl?.trim();
  assertDemoSeedTarget({
    confirmation: options.confirmation,
    demoDatabaseUrl,
    workspaceDatabaseUrl: options.workspaceDatabaseUrl
  });

  const pool = new pg.Pool({ connectionString: demoDatabaseUrl });
  let closeFinanceDb: (() => Promise<void>) | undefined;
  try {
    const preflight = await readDemoDatabasePreflight(pool);
    assertDemoDatabasePreflight(preflight);
    await ensureSeedMarker(pool, "seeding");

    const financeDb = await import("@/lib/db/finance-db");
    if (options.closeFinanceDb) closeFinanceDb = financeDb.closeFinanceDbForTests;
    await financeDb.readFinanceDbSnapshot();
    const authMigration = await readFile(path.join(process.cwd(), "db", "better-auth.sql"), "utf8");
    await pool.query(authMigration);

    const dataset = createDemoDataset(options.asOfDate);
    await resetPreviousDemoRows(pool);
    await seedCategories(pool, dataset);
    await seedGoalsAndDemoUser(pool, dataset);
    await financeDb.replaceLedgerInDb({
      ...dataset.ledger,
      transactions: dataset.ledger.transactions.map((transaction) => ({
        ...transaction,
        pairedTransactionId: undefined
      }))
    });
    await persistTransferPairs(pool, dataset);
    const investmentAccounts = dataset.ledger.accounts.filter((account) => account.type === "investment");
    const investmentAccountIds = new Set(investmentAccounts.map((account) => account.id));
    const investmentSnapshots = (dataset.ledger.balanceSnapshots ?? []).filter((snapshot) =>
      investmentAccountIds.has(snapshot.accountId)
    );

    await financeDb.replaceSnapTradeInvestmentSnapshot({
      accounts: investmentAccounts,
      balanceSnapshots: investmentSnapshots,
      errors: [],
      finishedAt: dataset.ledger.lastSyncedAt,
      positionAccountIds: [...investmentAccountIds],
      positions: dataset.investmentPositions,
      providerConnections: dataset.ledger.providerConnections.filter((connection) => connection.provider === "snaptrade"),
      startedAt: dataset.ledger.lastSyncedAt,
      successfulProviderConnectionIds: dataset.ledger.providerConnections
        .filter((connection) => connection.provider === "snaptrade")
        .map((connection) => connection.id)
    });

    // Rules go in after the ledger: replaceLedgerInDb re-applies stored rules,
    // and these already agree with the categories the ledger carries.
    await seedReviewAndOrganization(pool, dataset);
    await seedReceipts(financeDb, dataset);

    const snapshot = await financeDb.readFinanceDbSnapshot();
    if (!snapshot) throw new Error("Demo seed verification failed: no ledger was readable after write.");
    assertDemoDataset({ ...dataset, ledger: snapshot });

    const counts = await readSeedCounts(pool);
    assertWrittenCounts(counts, dataset);
    const { createRecurringItems, invalidateShellDataCache } = await import("@/lib/finance-data");
    const recurringCount = createRecurringItems(snapshot.transactions).length;
    if (recurringCount < demoRecurringRange.min || recurringCount > demoRecurringRange.max) {
      throw new Error(`Demo seed verification failed: derived ${recurringCount} recurring items.`);
    }
    await ensureSeedMarker(pool, "complete");
    invalidateShellDataCache();
    return { asOfDate: options.asOfDate, counts, recurringCount };
  } finally {
    await closeFinanceDb?.().catch(() => undefined);
    await pool.end();
  }
}

async function readDemoDatabasePreflight(database: pg.Pool) {
  const tables = await database.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  );
  const tableNames = tables.rows.map((row) => row.table_name);
  if (tableNames.length === 0) return { marker: undefined, nonDemoRowCounts: {}, tableNames, users: [] };
  const marker = tableNames.includes("sync_state")
    ? (await database.query<{ value: string }>(`SELECT value FROM sync_state WHERE key = 'demo_seed_marker'`)).rows[0]?.value
    : undefined;
  const nonDemoRowCounts: Record<string, number> = {};
  const checks = [
    ["provider_connections", "id"],
    ["accounts", "id"],
    ["transactions", "id"],
    ["financial_goals", "id"]
  ] as const;

  for (const [table, column] of checks) {
    if (!tableNames.includes(table)) continue;
    const result = await database.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} NOT LIKE 'demo_%'`);
    nonDemoRowCounts[table] = result.rows[0]?.count ?? 0;
  }
  const users = tableNames.includes("user")
    ? (await database.query<{ id: string; email: string }>(`SELECT id, email FROM "user"`)).rows
    : [];
  return { marker, nonDemoRowCounts, tableNames, users };
}

async function ensureSeedMarker(database: pg.Pool, state: "complete" | "seeding"): Promise<void> {
  await database.query(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await database.query(
    `INSERT INTO sync_state (key, value) VALUES ('demo_seed_marker', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [`${demoSeedMarker}:${state}`]
  );
}

async function resetPreviousDemoRows(database: pg.Pool): Promise<void> {
  await database.query("BEGIN");
  try {
    // This database is already ownership-marked and explicitly confirmed. Reset
    // every user/content/auth surface so a demo visitor cannot import private
    // data and have a later seed preserve it.
    await database.query(`TRUNCATE TABLE
      sync_run_items, sync_runs, account_balance_snapshots, investment_positions,
      transaction_evidence_links, enrichment_suggestions, transactions, accounts,
      provider_connections, financial_goals, agent_conversation_turns, agent_conversations,
      transaction_rules, semantic_embeddings, semantic_documents, source_items, line_item_categories,
      source_sync_runs, external_sources, app_sync_runs, sync_schedules, tag_registry,
      "session", apikey, passkey, "twoFactor", verification, "account", "user"
      CASCADE`);
    await database.query(`DELETE FROM categories WHERE id NOT IN (
      'cat_income', 'cat_housing', 'cat_food', 'cat_groceries', 'cat_transportation', 'cat_software',
      'cat_shopping', 'cat_household', 'cat_travel', 'cat_transfer', 'cat_other'
    )`);
    // The agent's model sign-in and model choice live here too and must survive every reseed.
    await database.query(`DELETE FROM sync_state WHERE key <> 'demo_seed_marker'
      AND key NOT LIKE 'chatgpt_oauth%' AND key NOT LIKE 'claude_oauth%' AND key <> 'llm_provider_settings_v1'`);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }
}

async function seedGoalsAndDemoUser(database: pg.Pool, dataset: ReturnType<typeof createDemoDataset>): Promise<void> {
  const passwordHash = await hashPassword(demoUser.password);
  await database.query("BEGIN");
  try {
    for (const goal of dataset.goals) {
      await database.query(
        `INSERT INTO financial_goals (id, name, emoji, target_amount_minor, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji,
           target_amount_minor = EXCLUDED.target_amount_minor, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
        [goal.id, goal.name, goal.emoji ?? null, goal.targetAmountMinor ?? null, goal.state, goal.createdAt, goal.updatedAt]
      );
    }

    await database.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, TRUE, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email,
         "emailVerified" = TRUE, "updatedAt" = NOW()`,
      [demoUser.id, demoUser.name, demoUser.email]
    );
    await database.query(
      `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET "accountId" = EXCLUDED."accountId", "providerId" = 'credential',
         "userId" = EXCLUDED."userId", password = EXCLUDED.password, "updatedAt" = NOW()`,
      ["demo_auth_credential", demoUser.id, demoUser.id, passwordHash]
    );
    await database.query(`DELETE FROM "session" WHERE "userId" = $1`, [demoUser.id]);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }
}

async function seedCategories(database: pg.Pool, dataset: ReturnType<typeof createDemoDataset>): Promise<void> {
  const timestamp = dataset.ledger.lastSyncedAt ?? new Date().toISOString();
  for (const category of dataset.categories) {
    await database.query(
      `INSERT INTO categories (id, name, emoji, color, archived, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, FALSE, $5, $6, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, emoji = EXCLUDED.emoji, color = EXCLUDED.color,
         archived = FALSE, sort_order = EXCLUDED.sort_order, updated_at = EXCLUDED.updated_at`,
      [category.id, category.name, category.emoji, category.color, category.sortOrder, timestamp]
    );
  }
}

async function seedReviewAndOrganization(database: pg.Pool, dataset: ReturnType<typeof createDemoDataset>): Promise<void> {
  const timestamp = dataset.ledger.lastSyncedAt ?? new Date().toISOString();
  await database.query("BEGIN");
  try {
    for (const rule of dataset.rules) {
      await database.query(
        `INSERT INTO transaction_rules (id, name, enabled, match_field, match_operator, pattern, category_id, tags,
           mark_reviewed, created_at, updated_at, last_applied_at, last_applied_count)
         VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7::jsonb, $8, $9, $9, $9, $10)`,
        [rule.id, rule.name, rule.matchField, rule.matchOperator, rule.pattern, rule.categoryId,
          JSON.stringify(rule.tags), rule.markReviewed, timestamp, demoRuleMatchCount(rule, dataset.ledger.transactions)]
      );
    }
    for (const suggestion of dataset.suggestions) {
      await database.query(
        `INSERT INTO enrichment_suggestions (id, transaction_id, action, status, confidence, category_id, tags,
           mark_reviewed, reason, source, created_at, updated_at)
         VALUES ($1, $2, 'set_category', 'pending', $3, $4, '[]'::jsonb, TRUE, $5, 'merchant_history', $6, $6)`,
        [suggestion.id, suggestion.transactionId, suggestion.confidence, suggestion.categoryId, suggestion.reason, timestamp]
      );
    }
    for (const [name, color] of Object.entries(dataset.tagColors)) {
      await database.query(`UPDATE tag_registry SET color = $2, updated_at = $3 WHERE name = $1`, [name, color, timestamp]);
    }
    await database.query(
      `INSERT INTO sync_state (key, value) VALUES ('category_budget_overrides', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(dataset.budgetOverrides)]
    );
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }
}

async function persistTransferPairs(database: pg.Pool, dataset: ReturnType<typeof createDemoDataset>): Promise<void> {
  const pairs = dataset.ledger.transactions
    .filter((transaction) => transaction.pairedTransactionId && transaction.id < transaction.pairedTransactionId)
    .map((transaction) => [transaction.id, transaction.pairedTransactionId!] as const);
  await database.query("BEGIN");
  try {
    for (const [leftId, rightId] of pairs) {
      const result = await database.query(
        `UPDATE transactions SET paired_transaction_id = CASE id WHEN $1 THEN $2 WHEN $2 THEN $1 END
         WHERE id = ANY($3)`,
        [leftId, rightId, [leftId, rightId]]
      );
      if (result.rowCount !== 2) {
        throw new Error(`Demo transfer persistence failed for ${leftId} and ${rightId}.`);
      }
    }
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }
}

interface SeedCounts {
  accessoryRows: number;
  accounts: number;
  authAccounts: number;
  brokenPairRows: number;
  credentialAccounts: number;
  goals: number;
  positions: number;
  pairedRows: number;
  coloredTags: number;
  contextSources: number;
  customCategories: number;
  evidenceLinks: number;
  lineItems: number;
  sourceItems: number;
  reviewQueue: number;
  rules: number;
  suggestions: number;
  tags: number;
  transactions: number;
  users: number;
}

/**
 * The itemized orders and receipts behind the household's charges, written the way a source sync
 * writes them, then linked to the charges they were paid in (accepted, or the matcher's suggestion
 * for the charges still in the review queue).
 */
async function seedReceipts(financeDb: typeof import("@/lib/db/finance-db"), dataset: ReturnType<typeof createDemoDataset>): Promise<void> {
  const { links, sources } = dataset.receipts;
  await financeDb.ensureExternalSourceCatalog(
    sources.map(({ command, displayName, id, kind }) => ({ command, displayName, id, kind, status: "connected" as const }))
  );
  for (const source of sources) {
    await financeDb.recordSourceSyncRun({
      finishedAt: dataset.ledger.lastSyncedAt,
      items: source.items,
      runStatus: "succeeded",
      sourceId: source.id,
      sourceStatus: "connected",
      startedAt: dataset.ledger.lastSyncedAt
    });
  }
  // The sync run's matcher has already guessed a charge for each item; the dataset states which
  // charge each one was paid in, so its guesses go before the stated links are written.
  await financeDb.clearSourceItemEvidenceLinks(sources.flatMap((source) => source.items.map((item) => item.id)));
  for (const link of links) {
    await financeDb.createTransactionEvidenceLink(link);
  }
  for (const split of dataset.receipts.lineCategories) {
    await financeDb.setSourceItemLineCategory(split.sourceItemId, split.position, split.categoryId);
  }
}

async function readSeedCounts(database: pg.Pool): Promise<SeedCounts> {
  const result = await database.query<SeedCounts>(`
    SELECT
      (SELECT COUNT(*)::int FROM accounts) AS accounts,
      (SELECT COUNT(*)::int FROM transactions) AS transactions,
      (SELECT COUNT(*)::int FROM investment_positions) AS positions,
      (SELECT COUNT(*)::int FROM financial_goals) AS goals,
      (SELECT COUNT(*)::int FROM transactions WHERE reviewed = FALSE) AS "reviewQueue",
      (SELECT COUNT(*)::int FROM "user") AS users,
      (SELECT COUNT(*)::int FROM "account") AS "authAccounts",
      (SELECT COUNT(*)::int FROM "account"
        WHERE id = 'demo_auth_credential' AND "providerId" = 'credential'
          AND "accountId" = '${demoUser.id}' AND "userId" = '${demoUser.id}'
          AND password IS NOT NULL) AS "credentialAccounts",
      (SELECT COUNT(*)::int FROM transactions WHERE paired_transaction_id IS NOT NULL) AS "pairedRows",
      (SELECT COUNT(*)::int
        FROM transactions t
        LEFT JOIN transactions counterpart ON counterpart.id = t.paired_transaction_id
        WHERE t.paired_transaction_id IS NOT NULL AND (
          counterpart.id IS NULL OR counterpart.paired_transaction_id IS DISTINCT FROM t.id OR
          counterpart.amount_minor <> -t.amount_minor OR counterpart.category_id <> 'cat_transfer' OR
          t.category_id <> 'cat_transfer'
        )) AS "brokenPairRows",
      (
        (SELECT COUNT(*) FROM "session") + (SELECT COUNT(*) FROM apikey) +
        (SELECT COUNT(*) FROM passkey) + (SELECT COUNT(*) FROM "twoFactor") +
        (SELECT COUNT(*) FROM verification) + (SELECT COUNT(*) FROM agent_conversations) +
        (SELECT COUNT(*) FROM agent_conversation_turns)
      )::int AS "accessoryRows",
      (SELECT COUNT(*)::int FROM external_sources) AS "contextSources",
      (SELECT COUNT(*)::int FROM source_items) AS "sourceItems",
      (SELECT COUNT(*)::int FROM source_item_lines) AS "lineItems",
      (SELECT COUNT(*)::int FROM transaction_evidence_links) AS "evidenceLinks",
      (SELECT COUNT(*)::int FROM tag_registry) AS tags,
      (SELECT COUNT(*)::int FROM tag_registry WHERE color IS NOT NULL) AS "coloredTags",
      (SELECT COUNT(*)::int FROM transaction_rules) AS rules,
      (SELECT COUNT(*)::int FROM enrichment_suggestions WHERE status = 'pending') AS suggestions,
      (SELECT COUNT(*)::int FROM categories WHERE id LIKE 'cat_custom_%') AS "customCategories"
  `);
  return result.rows[0];
}

function assertWrittenCounts(counts: SeedCounts, dataset: ReturnType<typeof createDemoDataset>): void {
  const receiptItems = dataset.receipts.sources.flatMap((source) => source.items);
  const expected = {
    accounts: dataset.ledger.accounts.length,
    goals: dataset.goals.length,
    positions: dataset.investmentPositions.length,
    transactions: dataset.ledger.transactions.length,
    users: 1,
    authAccounts: 1,
    accessoryRows: 0,
    contextSources: dataset.receipts.sources.length,
    sourceItems: receiptItems.length,
    lineItems: receiptItems.reduce((total, item) => total + (item.lines?.length ?? 0), 0),
    evidenceLinks: dataset.receipts.links.length,
    tags: new Set(dataset.ledger.transactions.flatMap((transaction) => transaction.tags ?? [])).size,
    coloredTags: Object.keys(dataset.tagColors).length,
    rules: dataset.rules.length,
    suggestions: dataset.suggestions.length,
    customCategories: dataset.categories.length,
    reviewQueue: dataset.ledger.transactions.filter((transaction) => !transaction.reviewed).length,
    credentialAccounts: 1,
    pairedRows: dataset.ledger.transactions.filter((transaction) => transaction.pairedTransactionId).length,
    brokenPairRows: 0
  };
  for (const key of [
    "accounts", "goals", "positions", "transactions", "users", "authAccounts",
    "accessoryRows", "tags", "coloredTags", "rules", "suggestions", "customCategories", "reviewQueue",
    "credentialAccounts", "pairedRows", "brokenPairRows", "contextSources", "sourceItems", "lineItems", "evidenceLinks"
  ] as const) {
    if (counts[key] !== expected[key]) throw new Error(`Demo seed verification failed for ${key}: expected ${expected[key]}, found ${counts[key]}.`);
  }
  if (counts.reviewQueue < 1) throw new Error("Demo seed verification failed: review queue is empty.");
}
