import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { resetLocalAppData } from "@/lib/db/finance-db";

export const runtime = "nodejs";

const requiredConfirmation = "DELETE LOCAL DATA";

export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const confirmation = parsed.body.confirmation;

  if (confirmation !== requiredConfirmation) {
    return NextResponse.json(
      {
        error: `Type ${requiredConfirmation} to clear local app data.`
      },
      { status: 400 }
    );
  }

  const summary = await resetLocalAppData();

  return NextResponse.json({
    object: "local_data_reset",
    ...toApiSummary(summary)
  });
}

function toApiSummary(summary: Awaited<ReturnType<typeof resetLocalAppData>>) {
  return {
    account_count: summary.accountCount,
    app_sync_run_count: summary.appSyncRunCount,
    evidence_link_count: summary.evidenceLinkCount,
    provider_connection_count: summary.providerConnectionCount,
    rule_count: summary.ruleCount,
    schedule_count: summary.scheduleCount,
    semantic_document_count: summary.semanticDocumentCount,
    semantic_embedding_count: summary.semanticEmbeddingCount,
    source_count: summary.sourceCount,
    source_item_count: summary.sourceItemCount,
    source_sync_run_count: summary.sourceSyncRunCount,
    suggestion_count: summary.suggestionCount,
    sync_run_count: summary.syncRunCount,
    transaction_count: summary.transactionCount
  };
}
