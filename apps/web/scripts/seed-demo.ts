#!/usr/bin/env node
// Seeds only an explicitly named, dedicated demo PostgreSQL database.
// Example:
// AI_FINANCES_DEMO_DATABASE_URL=postgresql://.../ai_finances_demo \
// AI_FINANCES_DEMO_SEED_CONFIRM=REPLACE_EXPLICIT_DEMO_DATABASE pnpm --dir apps/web demo:seed
// Optional: AI_FINANCES_DEMO_AS_OF=YYYY-MM-DD ends the ledger on that date.
// Run the app against that same database without loading the root .env:
// AI_FINANCES_IGNORE_WORKSPACE_ENV=1 DATABASE_URL="$AI_FINANCES_DEMO_DATABASE_URL" \
// BETTER_AUTH_SECRET="$AI_FINANCES_DEMO_BETTER_AUTH_SECRET" pnpm --dir apps/web dev

import { demoUser } from "../lib/demo-seed";
import { readWorkspaceEnv } from "../lib/workspace-env";

async function main(): Promise<void> {
  const workspaceEnv = readWorkspaceEnv();
  const demoDatabaseUrl = process.env.AI_FINANCES_DEMO_DATABASE_URL?.trim();
  const confirmation = process.env.AI_FINANCES_DEMO_SEED_CONFIRM;
  const asOfDate = process.env.AI_FINANCES_DEMO_AS_OF?.trim() || undefined;

  // The finance DB module reads DATABASE_URL on import, so the explicit target
  // is locked into process.env and workspace .env merging is disabled first.
  // runDemoSeed re-checks the target before any write.
  const { assertDemoSeedTarget } = await import("../lib/demo-seed");
  assertDemoSeedTarget({ confirmation, demoDatabaseUrl, workspaceDatabaseUrl: workspaceEnv.DATABASE_URL });
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  process.env.DATABASE_URL = demoDatabaseUrl;
  delete process.env.AI_FINANCES_PGLITE_DIR;

  const { runDemoSeed } = await import("../lib/demo-seed-runner");
  const { counts, recurringCount } = await runDemoSeed({
    asOfDate,
    closeFinanceDb: true,
    confirmation,
    demoDatabaseUrl,
    workspaceDatabaseUrl: workspaceEnv.DATABASE_URL
  });

  console.log("Demo seed complete.");
  console.log(
    `Ledger: ${counts.accounts} accounts, ${counts.transactions} transactions, ${counts.positions} positions, ${counts.goals} goals, ${counts.reviewQueue} awaiting review.`
  );
  console.log(`Recurring items detected: ${recurringCount}.`);
  console.log(`Login email: ${demoUser.email}. Credentials are the non-secret demoUser values in lib/demo-seed.ts.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo seed failed.");
  process.exitCode = 1;
});
