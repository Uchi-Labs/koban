#!/usr/bin/env node
// Run from repo root with: pnpm --dir apps/web auth:migrate
// Requires DATABASE_URL. The value is never printed.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run the better-auth migration.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "..", "db", "better-auth.sql");
const sql = await readFile(sqlPath, "utf8");
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  await pool.query(sql);
  console.log("better-auth migration completed.");
} finally {
  await pool.end();
}
