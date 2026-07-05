#!/usr/bin/env node

const defaultUrl = "http://127.0.0.1:3007";

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.watch) {
    await runWatch(options);
    return;
  }

  await runOnce(options);
}

async function runWatch(options) {
  const intervalMs = options.intervalMs ?? 60_000;

  if (!options.json) {
    console.log(`Watching due sync every ${Math.round(intervalMs / 1000)}s. Press Ctrl+C to stop.`);
  }

  while (true) {
    try {
      await runOnce(options);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Scheduled sync failed.");
    }

    await sleep(intervalMs);
  }
}

async function runOnce(options) {
  const baseUrl = normalizeBaseUrl(options.url ?? process.env.AI_FINANCES_APP_URL ?? defaultUrl);
  const body = {
    action: options.runNow ? "run_now" : "run_due"
  };

  if (options.enrichmentLimit !== undefined) {
    body.enrichment_limit = options.enrichmentLimit;
  }

  if (options.sourceIds.length > 0) {
    body.source_ids = options.sourceIds;
  }

  const response = await fetch(`${baseUrl}/api/v1/sync-schedule`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const text = await response.text();
  const payload = parseJsonResponse(text);

  if (!response.ok) {
    const message = payload && typeof payload.error === "string" ? payload.error : text || response.statusText;
    throw new Error(`Scheduled sync request failed (${response.status}): ${message}`);
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  console.log(formatSyncScheduleResult(payload));
  return payload;
}

function parseArgs(args) {
  const options = {
    help: false,
    json: false,
    runNow: false,
    sourceIds: [],
    url: undefined,
    watch: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--run-now":
        options.runNow = true;
        break;
      case "--watch":
        options.watch = true;
        break;
      case "--url":
        options.url = requireValue(args, (index += 1), "--url");
        break;
      case "--interval-ms":
        options.intervalMs = parsePositiveInteger(requireValue(args, (index += 1), "--interval-ms"), "--interval-ms");
        break;
      case "--enrichment-limit":
        options.enrichmentLimit = parsePositiveInteger(
          requireValue(args, (index += 1), "--enrichment-limit"),
          "--enrichment-limit"
        );
        break;
      case "--source-id":
        options.sourceIds.push(...splitSourceIds(requireValue(args, (index += 1), "--source-id")));
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

function splitSourceIds(value) {
  return value
    .split(",")
    .map((sourceId) => sourceId.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, option) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer.`);
  }

  return parsed;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatSyncScheduleResult(payload) {
  if (!payload || payload.object !== "sync_schedule_run") {
    return "Scheduled sync returned an unexpected response.";
  }

  if (payload.status === "skipped") {
    return `Scheduled sync skipped: ${payload.reason ?? "not_due"}.`;
  }

  const run = payload.run;
  const status = run?.status ?? "unknown";
  const teller = run?.teller?.status ?? "unknown";
  const sources = run?.sources?.status ?? "unknown";
  const enrichment = run?.enrichment?.status ?? "unknown";

  return `Scheduled sync ran: ${status}. Teller ${teller}; sources ${sources}; AI ${enrichment}.`;
}

function printHelp() {
  console.log(`Usage: node apps/web/scripts/sync-due.mjs [options]

Calls the local app's /api/v1/sync-schedule endpoint.

Options:
  --url <url>              App URL. Defaults to AI_FINANCES_APP_URL or ${defaultUrl}
  --run-now                Run immediately instead of only when the schedule is due
  --watch                  Keep checking on an interval
  --interval-ms <ms>       Watch interval. Defaults to 60000
  --enrichment-limit <n>   Max AI enrichment candidates for the sync
  --source-id <id[,id]>    Restrict source sync to one or more source ids
  --json                   Print raw JSON response
  --help                   Show this help
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Scheduled sync failed.");
  process.exitCode = 1;
});
