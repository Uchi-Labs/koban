#!/usr/bin/env node
// Seeds only an explicitly named, dedicated demo PostgreSQL database.
// Example:
// AI_FINANCES_DEMO_DATABASE_URL=postgresql://.../ai_finances_demo \
// AI_FINANCES_DEMO_SEED_CONFIRM=REPLACE_EXPLICIT_DEMO_DATABASE pnpm --dir apps/web demo:seed
// Run the app against that same database without loading the root .env:
// AI_FINANCES_IGNORE_WORKSPACE_ENV=1 DATABASE_URL="$AI_FINANCES_DEMO_DATABASE_URL" \
// BETTER_AUTH_SECRET="$AI_FINANCES_DEMO_BETTER_AUTH_SECRET" pnpm --dir apps/web dev

import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import {
  assertDemoDataset,
  assertDemoDatabasePreflight,
  assertDemoSeedTarget,
  createDemoDataset,
  demoSeedMarker,
  demoUser
} from "../lib/demo-seed";
import { readWorkspaceEnv } from "../lib/workspace-env";

async function main(): Promise<void> {
  const workspaceEnv = readWorkspaceEnv();
  const demoDatabaseUrl = process.env.AI_FINANCES_DEMO_DATABASE_URL?.trim();
  assertDemoSeedTarget({
    confirmation: process.env.AI_FINANCES_DEMO_SEED_CONFIRM,
    demoDatabaseUrl,
    workspaceDatabaseUrl: workspaceEnv.DATABASE_URL
  });

  const pool = new pg.Pool({ connectionString: demoDatabaseUrl });
  let closeFinanceDb: (() => Promise<void>) | undefined;
  try {
    const preflight = await readDemoDatabasePreflight(pool);
    assertDemoDatabasePreflight(preflight);
    await ensureSeedMarker(pool, "seeding");

    // Only the read-only preflight may run before the explicit target is locked
    // into process.env and workspace .env merging is disabled.
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.DATABASE_URL = demoDatabaseUrl;
    delete process.env.AI_FINANCES_PGLITE_DIR;
    const financeDb = await import("../lib/db/finance-db");
    closeFinanceDb = financeDb.closeFinanceDbForTests;
    await financeDb.readFinanceDbSnapshot();
    const authMigration = await readFile(path.join(process.cwd(), "db", "better-auth.sql"), "utf8");
    await pool.query(authMigration);

    const dataset = createDemoDataset();
    await resetPreviousDemoRows(pool);
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

    const snapshot = await financeDb.readFinanceDbSnapshot();
    if (!snapshot) throw new Error("Demo seed verification failed: no ledger was readable after write.");
    assertDemoDataset({ ...dataset, ledger: snapshot });

    const counts = await readSeedCounts(pool);
    assertWrittenCounts(counts, dataset);
    const { createRecurringItems } = await import("../lib/finance-data");
    const recurringCount = createRecurringItems(snapshot.transactions).length;
    if (recurringCount < 8 || recurringCount > 15) {
      throw new Error(`Demo seed verification failed: derived ${recurringCount} recurring items.`);
    }
    await ensureSeedMarker(pool, "complete");

    console.log("Demo seed complete.");
    console.log(
      `Ledger: ${counts.accounts} accounts, ${counts.transactions} transactions, ${counts.positions} positions, ${counts.goals} goals, ${counts.reviewQueue} awaiting review.`
    );
    console.log(`Recurring items detected: ${recurringCount}.`);
    console.log(`Login email: ${demoUser.email}. Credentials are the non-secret demoUser values in lib/demo-seed.ts.`);
  } finally {
    await closeFinanceDb?.().catch(() => undefined);
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo seed failed.");
  process.exitCode = 1;
});

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
      transaction_rules, semantic_embeddings, semantic_documents, source_items,
      source_sync_runs, external_sources, app_sync_runs, sync_schedules, tag_registry,
      "session", apikey, passkey, "twoFactor", verification, "account", "user"
      CASCADE`);
    await database.query(`DELETE FROM categories WHERE id NOT IN (
      'cat_income', 'cat_housing', 'cat_food', 'cat_transportation', 'cat_software',
      'cat_shopping', 'cat_travel', 'cat_transfer', 'cat_other'
    )`);
    await database.query(`DELETE FROM sync_state WHERE key <> 'demo_seed_marker'`);
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
  reviewQueue: number;
  tags: number;
  transactions: number;
  users: number;
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
        (SELECT COUNT(*) FROM agent_conversation_turns) + (SELECT COUNT(*) FROM transaction_rules) +
        (SELECT COUNT(*) FROM enrichment_suggestions) + (SELECT COUNT(*) FROM transaction_evidence_links) +
        (SELECT COUNT(*) FROM source_items) + (SELECT COUNT(*) FROM external_sources)
      )::int AS "accessoryRows",
      (SELECT COUNT(*)::int FROM tag_registry) AS tags
  `);
  return result.rows[0];
}

function assertWrittenCounts(counts: SeedCounts, dataset: ReturnType<typeof createDemoDataset>): void {
  const expected = {
    accounts: dataset.ledger.accounts.length,
    goals: dataset.goals.length,
    positions: dataset.investmentPositions.length,
    transactions: dataset.ledger.transactions.length,
    users: 1,
    authAccounts: 1,
    accessoryRows: 0,
    tags: 2,
    credentialAccounts: 1,
    pairedRows: dataset.ledger.transactions.filter((transaction) => transaction.pairedTransactionId).length,
    brokenPairRows: 0
  };
  for (const key of [
    "accounts", "goals", "positions", "transactions", "users", "authAccounts",
    "accessoryRows", "tags", "credentialAccounts", "pairedRows", "brokenPairRows"
  ] as const) {
    if (counts[key] !== expected[key]) throw new Error(`Demo seed verification failed for ${key}: expected ${expected[key]}, found ${counts[key]}.`);
  }
  if (counts.reviewQueue < 1) throw new Error("Demo seed verification failed: review queue is empty.");
}
