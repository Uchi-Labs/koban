import { NextResponse } from "next/server";
import { readOptionalJsonObject } from "@/lib/api-request";
import { appSyncRunRecordToPayload, syncScheduleRecordToPayload } from "@/lib/app-sync-runs";
import { runAppSync } from "@/lib/app-sync-service";
import {
  ensureAppSyncSchedule,
  getEffectiveLlmEnrichmentStatus,
  getLatestAppSyncRun,
  listAppSyncRuns
} from "@/lib/db/finance-db";
import { isEnrichmentProviderReady } from "@/lib/llm-enrichment";
import { getSourceAdapterDiagnostics, summarizeSourceReadiness } from "@/lib/source-adapters";
import { parseOptionalEnrichmentLimit, parseOptionalSourceIds } from "@/lib/sync-request";
import { getTellerSetupStatus } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function GET() {
  const [teller, sources, lastRun, recentRuns, schedule] = await Promise.all([
    getTellerSetupStatus(),
    getSourceAdapterDiagnostics(),
    getLatestAppSyncRun(),
    listAppSyncRuns(5),
    ensureAppSyncSchedule()
  ]);
  const llmProvider = await getEffectiveLlmEnrichmentStatus();
  const sourceReadiness = summarizeSourceReadiness(sources);

  return NextResponse.json({
    object: "app_sync_status",
    ready: {
      enrichment: isEnrichmentProviderReady(llmProvider),
      sources: sourceReadiness.ready,
      teller: teller.readyForApi
    },
    teller: {
      enrollment_count: teller.enrollmentCount,
      ready_for_api: teller.readyForApi,
      stored_account_count: teller.storedAccountCount,
      stored_transaction_count: teller.storedTransactionCount
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

  const run = await runAppSync({ enrichmentLimit: enrichmentLimit.value, sourceIds: sourceIds.value });

  return NextResponse.json(appSyncRunRecordToPayload(run));
}
