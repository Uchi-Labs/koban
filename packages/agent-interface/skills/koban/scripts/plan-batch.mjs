#!/usr/bin/env node
// Plans one context-backfill batch. Its stdout is the instruction the agent
// follows: which mailboxes are live right now, which transactions to work, and
// the exact evidence commands for each, in order.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const usage = "Usage: plan-batch.mjs [--limit N (1-50, default 10)] [--retry none|unsure] [--category ID (default cat_other)] [--skip-verify]";
const options = parseArgs(process.argv.slice(2));
const day = 86_400_000;
// Receipts usually land within a few days of the charge; card posting lags
// the purchase, so the window opens before the authorization date.
const windowBefore = 3;
const windowAfter = 3;
// Amazon charges each shipment separately, often weeks after the order.
const amazonLookbackDays = 30;
// The receipt for these charges comes from the platform, not the merchant.
const platforms = [
  [/\bDD \*|DOORDASH/i, "DoorDash"],
  [/UBER\s*\*?\s*EATS/i, "Uber Eats"],
  [/\bUBER\b/i, "Uber"],
  [/\bLYFT\b/i, "Lyft"],
  [/GRUBHUB/i, "Grubhub"],
  [/INSTACART/i, "Instacart"],
  [/AIRBNB/i, "Airbnb"],
  [/PAYPAL \*/i, "PayPal"],
  [/APPLE\.COM\/BILL/i, "Apple"],
  [/AMAZON|AMZN/i, "Amazon"]
];
const transferPattern = /\b(transfer|xfer|vault|autopay|payment thank you|online payment|to savings|from savings|to checking|from checking)\b/i;

const mailboxes = await liveMailboxes(options.skipVerify);
const { batch, skipped, hasMore } = await selectTransactions(options);
const live = mailboxes.filter((mailbox) => mailbox.live);

const plan = {
  directive: batch.length === 0
    ? "NOTHING_TO_DO: no eligible transactions. Report this and stop."
    : live.length === 0
      ? "NO_LIVE_MAILBOXES: run only the stored-evidence commands below, then report which mailboxes need login (see references/connectors.md)."
      : `WORK_BATCH: process the ${batch.length} transactions in order. For each, run its commands in order and stop at the first confident match. Decide with the match rubric, write, read back, then move to the next.`,
  live_mailboxes: live.map((mailbox) => mailbox.sourceId),
  unavailable_mailboxes: mailboxes.filter((mailbox) => !mailbox.live).map((mailbox) => `${mailbox.sourceId} (${mailbox.reason})`),
  skipped,
  more_eligible_after_batch: hasMore,
  batch: batch.map((transaction) => describe(transaction, live))
};
console.log(JSON.stringify(plan, null, 2));

function describe(transaction, live) {
  const dates = [transaction.date, transaction.authorized_date].filter(Boolean).sort();
  const from = shiftDate(dates[0], -windowBefore);
  const to = shiftDate(dates.at(-1), windowAfter);
  const amount = Math.abs(transaction.amount).toFixed(2);
  const keyword = merchantKeyword(transaction);
  const text = `${transaction.merchant_name ?? ""} ${transaction.description ?? ""}`;
  const platform = platforms.find(([pattern]) => pattern.test(text))?.[1];
  const searchKeyword = platform ?? keyword;
  const likelyTransfer = transferPattern.test(text);
  const commands = likelyTransfer
    ? [`koban transactions evidence ${transaction.id} --json`]
    : [
      `koban transactions evidence ${transaction.id} --json`,
      `koban sources items --amount ${amount} --from ${from} --to ${to} --limit 20 --json`,
      ...[...new Set([keyword, platform].filter(Boolean))].map((word) => `koban sources items --q ${quote(word)} --from ${from} --to ${to} --limit 20 --json`),
      ...(platform === "Amazon" ? [`koban sources items --source source_amazon_orders --from ${shiftDate(dates[0], -amazonLookbackDays)} --to ${to} --limit 30 --json`] : []),
      ...live.map((mailbox) => `koban sources search ${mailbox.sourceId} --from ${from} --to ${to}${searchKeyword ? ` --q ${quote(searchKeyword)}` : ""} --limit 10 --json`)
    ];
  return {
    id: transaction.id,
    date: transaction.date,
    amount: transaction.amount,
    merchant: transaction.merchant_name ?? null,
    description: transaction.description,
    account: transaction.account_name,
    category_id: transaction.category_id,
    ...(platform ? { platform } : {}),
    ...(likelyTransfer ? { hint: "LIKELY_TRANSFER: confirm a matching opposite-sign transaction in another owned account; if found, categorize cat_transfer. No mailbox search." } : {}),
    window: { from, to },
    commands
  };
}

// Mailboxes are ordered by stored item count so the ones that have produced
// evidence before are searched first; Gmail's per-user quota is low.
async function liveMailboxes(skipVerify) {
  const status = await koban(["connectors", "status", ...(skipVerify ? [] : ["--verify"]), "--json"]);
  return (status.data ?? []).flatMap((row) => {
    const match = /^(gmail|outlook):(.+)$/.exec(row.id ?? "");
    if (!match) return [];
    const sourceId = `${match[1] === "gmail" ? "source_gmail" : "source_outlook_email"}__${match[2]}`;
    const live = skipVerify ? row.authentication === "credentials_present" : row.live_access === "verified";
    return [{ live, reason: skipVerify ? `unverified, ${row.authentication}` : `live access ${row.live_access}`, sourceId, stored: row.imported_records ?? 0 }];
  }).sort((left, right) => right.stored - left.stored);
}

async function selectTransactions({ category, limit, retry }) {
  const batch = [];
  const skipped = { pending: 0, already_backfilled: 0 };
  let startingAfter;
  for (let page = 0; page < 30; page += 1) {
    const result = await koban(["transactions", "list", "--category", category, "--no-reviewed", "--limit", "100", ...(startingAfter ? ["--starting-after", startingAfter] : []), "--json"]);
    const rows = result.data ?? [];
    for (const transaction of rows) {
      // Plaid issues a new ID when a pending charge posts, so writes to a
      // pending row would be orphaned.
      if (transaction.status === "pending") { skipped.pending += 1; continue; }
      const outcome = (transaction.tags ?? []).find((tag) => tag.startsWith("backfill:"));
      if (outcome && outcome !== `backfill:${retry}`) { skipped.already_backfilled += 1; continue; }
      if (!outcome && retry) continue;
      if (batch.length === limit) return { batch, skipped, hasMore: true };
      batch.push(transaction);
    }
    if (!result.has_more || rows.length === 0) break;
    startingAfter = rows.at(-1).id;
  }
  return { batch, skipped, hasMore: false };
}

async function koban(args) {
  try {
    const { stdout } = await run("koban", args, { maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = error.stdout || error.stderr || error.message;
    console.log(JSON.stringify({ directive: `KOBAN_UNAVAILABLE: \`koban ${args.join(" ")}\` failed. Run \`koban doctor\`, fix the backend, then rerun this planner. Stop until it succeeds.`, detail: String(detail).slice(0, 600) }, null, 2));
    process.exit(1);
  }
}

function merchantKeyword(transaction) {
  if (transaction.merchant_name?.trim()) return transaction.merchant_name.trim();
  const words = (transaction.description ?? "").replace(/[^A-Za-z&' ]+/g, " ").split(/\s+/).filter((word) => word.length > 1);
  return words.slice(0, 2).join(" ");
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
}

function quote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseArgs(argv) {
  const parsed = { category: "cat_other", limit: 10, retry: undefined, skipVerify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--skip-verify") { parsed.skipVerify = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (flag === "--limit" && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 50) parsed.limit = Number(value);
    else if (flag === "--retry" && ["none", "unsure"].includes(value)) parsed.retry = value;
    else if (flag === "--category" && value) parsed.category = value;
    else { console.error(usage); process.exit(2); }
  }
  return parsed;
}
