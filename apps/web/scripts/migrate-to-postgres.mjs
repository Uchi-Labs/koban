#!/usr/bin/env node

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const { Pool } = pg;

const tableNames = [
  "sync_state",
  "provider_connections",
  "sync_runs",
  "accounts",
  "external_sources",
  "app_sync_runs",
  "sync_schedules",
  "sync_run_items",
  "account_balance_snapshots",
  "transactions",
  "transaction_rules",
  "enrichment_suggestions",
  "source_sync_runs",
  "source_items",
  "transaction_evidence_links",
  "embedding_models",
  "semantic_documents",
  "semantic_embeddings"
];

const schemaSql = `
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL,
    configured BOOLEAN NOT NULL,
    last_synced_at TEXT,
    stale_after TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    accounts_seen INTEGER NOT NULL DEFAULT 0,
    transactions_seen INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_run_items (
    id TEXT PRIMARY KEY,
    sync_run_id TEXT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    provider_resource_id TEXT,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    institution_name TEXT NOT NULL,
    type TEXT NOT NULL,
    mask TEXT,
    currency TEXT NOT NULL,
    current_balance_minor INTEGER NOT NULL,
    available_balance_minor INTEGER,
    included_in_net_worth BOOLEAN NOT NULL,
    last_updated_at TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS account_balance_snapshots (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    as_of_date TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    ledger_balance_minor INTEGER NOT NULL,
    available_balance_minor INTEGER,
    currency TEXT NOT NULL,
    source TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider_connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    authorized_date TEXT,
    posted_date TEXT,
    merchant_name TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    category_id TEXT NOT NULL,
    status TEXT NOT NULL,
    reviewed BOOLEAN NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    pending_transaction_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC);
  CREATE INDEX IF NOT EXISTS transactions_account_date_idx ON transactions(account_id, date DESC);
  CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions(category_id);

  CREATE TABLE IF NOT EXISTS transaction_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    match_field TEXT NOT NULL,
    match_operator TEXT NOT NULL,
    pattern TEXT NOT NULL,
    category_id TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    mark_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_applied_at TEXT,
    last_applied_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS transaction_rules_enabled_idx ON transaction_rules(enabled);

  CREATE TABLE IF NOT EXISTS enrichment_suggestions (
    id TEXT PRIMARY KEY,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    confidence REAL NOT NULL,
    category_id TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    rule_name TEXT,
    rule_match_field TEXT,
    rule_match_operator TEXT,
    rule_pattern TEXT,
    mark_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    applied_at TEXT
  );

  CREATE INDEX IF NOT EXISTS enrichment_suggestions_status_idx ON enrichment_suggestions(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS enrichment_suggestions_transaction_idx ON enrichment_suggestions(transaction_id);

  CREATE TABLE IF NOT EXISTS external_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL,
    configured BOOLEAN NOT NULL DEFAULT FALSE,
    command TEXT,
    last_synced_at TEXT,
    cursor TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS source_sync_runs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    items_seen INTEGER NOT NULL DEFAULT 0,
    items_written INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS app_sync_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    teller_status TEXT NOT NULL,
    sources_status TEXT NOT NULL,
    enrichment_status TEXT NOT NULL,
    teller_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    sources_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    enrichment_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_schedules (
    id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    interval_minutes INTEGER NOT NULL,
    next_run_at TEXT,
    last_started_at TEXT,
    last_finished_at TEXT,
    last_run_id TEXT,
    last_status TEXT,
    last_error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    occurred_at TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    merchant_name TEXT,
    amount_minor INTEGER,
    currency TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_id, external_id)
  );

  CREATE TABLE IF NOT EXISTS transaction_evidence_links (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL,
    confidence REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (transaction_id, source_item_id, relationship)
  );

  CREATE INDEX IF NOT EXISTS source_items_source_occurred_idx ON source_items(source_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS source_items_kind_idx ON source_items(kind);
  CREATE INDEX IF NOT EXISTS app_sync_runs_started_idx ON app_sync_runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS sync_schedules_next_run_idx ON sync_schedules(enabled, next_run_at);
  CREATE INDEX IF NOT EXISTS transaction_evidence_links_transaction_idx ON transaction_evidence_links(transaction_id);
  CREATE INDEX IF NOT EXISTS transaction_evidence_links_source_item_idx ON transaction_evidence_links(source_item_id);

  CREATE TABLE IF NOT EXISTS embedding_models (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    distance_metric TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retired_at TEXT
  );

  CREATE TABLE IF NOT EXISTS semantic_documents (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    body TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    stale_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (resource_type, resource_id)
  );

  CREATE TABLE IF NOT EXISTS semantic_embeddings (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES semantic_documents(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL REFERENCES embedding_models(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    body_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (document_id, model_id, body_hash)
  );

  CREATE INDEX IF NOT EXISTS semantic_documents_resource_idx ON semantic_documents(resource_type, resource_id);
`;

const postgresIndexSql = `
  CREATE INDEX IF NOT EXISTS semantic_embeddings_embedding_hnsw_idx
  ON semantic_embeddings USING hnsw (embedding vector_cosine_ops);
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const workspaceRoot = findWorkspaceRoot();
  const env = readWorkspaceEnv(workspaceRoot);
  const sourcePath = options.sourcePath ?? env.AI_FINANCES_PGLITE_DIR ?? path.join(workspaceRoot, "data", "local", "pglite");
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required and must point at the target Postgres database.");
  }

  if (sourcePath === ":memory:" || !existsSync(sourcePath)) {
    throw new Error(`PGlite source directory does not exist: ${sourcePath}`);
  }

  const sourceDb = new PGlite(sourcePath, { extensions: { vector } });
  const targetPool = new Pool({ connectionString: databaseUrl });

  try {
    await runSql(targetPool, schemaSql);
    await runSql(targetPool, postgresIndexSql);

    console.log(`Migrating PGlite source: ${sourcePath}`);
    console.log("Target Postgres: configured via DATABASE_URL");

    for (const tableName of tableNames) {
      const sourceRows = (await sourceDb.query(`SELECT * FROM ${quoteIdentifier(tableName)}`)).rows;
      const inserted = await insertRows(targetPool, tableName, sourceRows);
      const targetCount = await countRows(targetPool, tableName);
      console.log(`${tableName}: source=${sourceRows.length} inserted=${inserted} target=${targetCount}`);
    }
  } finally {
    await sourceDb.close().catch(() => undefined);
    await targetPool.end().catch(() => undefined);
  }
}

async function insertRows(pool, tableName, rows) {
  let inserted = 0;

  for (const row of rows) {
    const columns = Object.keys(row);

    if (columns.length === 0) {
      continue;
    }

    const columnSql = columns.map(quoteIdentifier).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const values = columns.map((column) => normalizeValue(tableName, column, row[column]));
    const result = await pool.query(
      `INSERT INTO ${quoteIdentifier(tableName)} (${columnSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values
    );

    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

async function countRows(pool, tableName) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(tableName)}`);
  return result.rows[0]?.count ?? 0;
}

async function runSql(pool, sql) {
  for (const statement of splitSqlStatements(sql)) {
    await pool.query(statement);
  }
}

function normalizeValue(tableName, column, value) {
  if (tableName === "semantic_embeddings" && column === "embedding") {
    if (Array.isArray(value)) {
      return `[${value.join(",")}]`;
    }

    if (ArrayBuffer.isView(value)) {
      return `[${Array.from(value).join(",")}]`;
    }
  }

  return value;
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function parseArgs(args) {
  const options = {
    help: false,
    sourcePath: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--source-pglite-dir":
        options.sourcePath = requireValue(args, (index += 1), "--source-pglite-dir");
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(args, index, option) {
  const value = args[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }

  return value;
}

function findWorkspaceRoot(startDirectory = process.cwd()) {
  let currentDirectory = startDirectory;

  while (currentDirectory !== path.dirname(currentDirectory)) {
    if (existsSync(path.join(currentDirectory, "pnpm-workspace.yaml"))) {
      return currentDirectory;
    }

    currentDirectory = path.dirname(currentDirectory);
  }

  return startDirectory;
}

function readWorkspaceEnv(workspaceRoot) {
  const envPath = path.join(workspaceRoot, ".env");
  const fileEnv =
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV === "1"
      ? {}
      : existsSync(envPath)
        ? parseEnvFile(readFileSync(envPath, "utf8"))
        : {};

  return {
    ...compactProcessEnv(process.env),
    ...fileEnv
  };
}

function compactProcessEnv(env) {
  const result = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0) {
      result[key] = value;
    }
  }

  return result;
}

function parseEnvFile(source) {
  const result = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      result[key] = parseEnvValue(rawValue);
    }
  }

  return result;
}

function parseEnvValue(rawValue) {
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1);
  }

  const commentIndex = rawValue.indexOf(" #");
  return commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex).trim();
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inSingleQuote) {
      current += char;

      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += char;

      if (char === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();

      if (statement.length > 0) {
        statements.push(statement);
      }

      current = "";
      continue;
    }

    current += char;
  }

  const finalStatement = current.trim();
  return finalStatement.length > 0 ? [...statements, finalStatement] : statements;
}

function printHelp() {
  console.log(`Usage: node apps/web/scripts/migrate-to-postgres.mjs [options]

Copies the local PGlite finance database into the Postgres database configured
by DATABASE_URL. The target schema is bootstrapped if needed. Connection string
values are never printed.

Options:
  --source-pglite-dir <path>  PGlite source directory. Defaults to
                              AI_FINANCES_PGLITE_DIR or data/local/pglite.
  --help                      Show this help.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Postgres migration failed.");
  process.exitCode = 1;
});
