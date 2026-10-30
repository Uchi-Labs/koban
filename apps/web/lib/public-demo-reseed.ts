// Keeps the public demo's ledger ending yesterday and clears visitors' review
// edits: seeds once at boot, then checks hourly and reseeds when the date has
// moved on or the last seed is a few hours old.

import { runDemoSeed } from "@/lib/demo-seed-runner";
import { yesterdayIsoDate } from "@/lib/public-demo";

const CHECK_INTERVAL_MS = 60 * 60_000;
const MAX_SEED_AGE_MS = 3 * 60 * 60_000;

let started = false;
let seededAsOf: string | undefined;
let seededAtMs = 0;
let running = false;

export function startPublicDemoReseed(): void {
  if (started) return;
  started = true;
  void reseedIfStale();
  setInterval(() => void reseedIfStale(), CHECK_INTERVAL_MS).unref();
}

async function reseedIfStale(): Promise<void> {
  const asOfDate = yesterdayIsoDate();
  if (running || (seededAsOf === asOfDate && Date.now() - seededAtMs < MAX_SEED_AGE_MS)) return;
  running = true;
  try {
    const { counts } = await runDemoSeed({
      asOfDate,
      confirmation: process.env.AI_FINANCES_DEMO_SEED_CONFIRM,
      demoDatabaseUrl: process.env.DATABASE_URL
    });
    seededAsOf = asOfDate;
    seededAtMs = Date.now();
    console.info(`[public-demo] seeded ledger through ${asOfDate}: ${counts.transactions} transactions.`);
  } catch (error) {
    console.error("[public-demo] reseed failed:", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}
