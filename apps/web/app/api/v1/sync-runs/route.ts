import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { syncInProgressResponse } from "@/lib/api-error";
import { readOptionalJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload, syncScheduleRecordToPayload } from "@/lib/app-sync-runs";
import { runAppSync } from "@/lib/app-sync-service";
import {
  appSyncScheduleId,
  ensureAppSyncSchedule,
  getLatestAppSyncRun,
  listAppSyncRuns,
  snapTradeSyncScheduleId
} from "@/lib/db/finance-db";
import { getEffectiveLlmEnrichmentStatus } from "@/lib/enrichment-runs";
import { maskLlmStatusForPublicDemo } from "@/lib/public-demo";
import { isEnrichmentProviderReady } from "@/lib/llm-enrichment";
import { getSourceAdapterDiagnostics, summarizeSourceReadiness } from "@/lib/source-adapters";
import { getPlaidSetupStatus } from "@/lib/plaid-server";
import { getSimpleFinSetupStatus } from "@/lib/simplefin-server";
import { getSnapTradeSetupStatus } from "@/lib/snaptrade-server";
import { runExclusiveSync } from "@/lib/sync-schedule-coordinator";
import { parseOptionalEnrichmentLimit, parseOptionalSourceIds } from "@/lib/sync-request";

export const runtime = "nodejs";

export async function GET() {
  const [snaptrade, plaid, simplefin, sources, lastRun, recentRuns, schedule] = await Promise.all([
    getSnapTradeSetupStatus(),
    getPlaidSetupStatus(),
    getSimpleFinSetupStatus(),
    getSourceAdapterDiagnostics(),
    getLatestAppSyncRun(),
    listAppSyncRuns(5),
    ensureAppSyncSchedule()
  ]);
  const llmProvider = maskLlmStatusForPublicDemo(await getEffectiveLlmEnrichmentStatus());
  const sourceReadiness = summarizeSourceReadiness(sources);

  return NextResponse.json({
    object: "app_sync_status",
    ready: {
      enrichment: isEnrichmentProviderReady(llmProvider),
      plaid: plaid.readyForSync,
      simplefin: simplefin.readyForSync,
      sources: sourceReadiness.ready,
      snaptrade: snaptrade.readyForSync
    },
    snaptrade: {
      configured: snaptrade.configured,
      connection_count: snaptrade.connectionCount,
      last_synced_at: snaptrade.lastSyncedAt,
      ready_for_sync: snaptrade.readyForSync,
      registered: snaptrade.registered,
      stored_account_count: snaptrade.storedAccountCount,
      stored_position_count: snaptrade.storedPositionCount
    },
    plaid: {
      configured: plaid.configured,
      item_count: plaid.itemCount,
      last_synced_at: plaid.lastSyncedAt,
      ready_for_sync: plaid.readyForSync,
      standby_institution_names: plaid.standbyInstitutionNames,
      stored_account_count: plaid.storedAccountCount,
      stored_transaction_count: plaid.storedTransactionCount
    },
    simplefin: {
      configured: simplefin.configured,
      connection_count: simplefin.connectionCount,
      last_errors: simplefin.lastErrors,
      last_synced_at: simplefin.lastSyncedAt,
      latest_balance_as_of: simplefin.latestBalanceAsOf,
      ready_for_sync: simplefin.readyForSync,
      stored_account_count: simplefin.storedAccountCount,
      stored_transaction_count: simplefin.storedTransactionCount
    },
    sources: {
      blocked_count: sourceReadiness.blockedCount,
      external_source_count: sources.summary.externalSourceCount,
      installed_count: sourceReadiness.installedCount,
      ready_count: sourceReadiness.readyCount,
      source_item_count: sources.summary.sourceItemCount
    },
    enrichment: {
      llm_provider: {
        configured: llmProvider.configured,
        error_message: llmProvider.errorMessage,
        model: llmProvider.model,
        provider: llmProvider.provider,
        status: llmProvider.status
      }
    },
    last_run: lastRun ? appSyncRunRecordToPayload(lastRun) : null,
    recent_runs: recentRuns.map(appSyncRunRecordToPayload),
    schedule: syncScheduleRecordToPayload(schedule)
  });
}

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const enrichmentLimit = parseOptionalEnrichmentLimit(parsed.body.enrichment_limit);

  if (!enrichmentLimit.ok) {
    return NextResponse.json({ error: enrichmentLimit.error }, { status: 400 });
  }

  const sourceIds = parseOptionalSourceIds(parsed.body.source_ids);

  if (!sourceIds.ok) {
    return NextResponse.json({ error: sourceIds.error }, { status: 400 });
  }

  const result = await runExclusiveSync(
    {
      claimedBy: `sync-runs-api:${process.pid}:${randomUUID()}`,
      scheduleIds: [appSyncScheduleId, snapTradeSyncScheduleId]
    },
    (signal) =>
      runAppSync({
        enrichmentLimit: enrichmentLimit.value,
        includePlaid: true,
        includeSimpleFin: true,
        signal,
        sourceIds: sourceIds.value
      })
  );

  if (result.status === "skipped") {
    return syncInProgressResponse();
  }

  return NextResponse.json(appSyncRunRecordToPayload(result.value));
}
