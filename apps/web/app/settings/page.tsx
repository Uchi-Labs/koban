import { cookies } from "next/headers";
import { SettingsView } from "@/components/settings-view";
import { appSyncRunRecordToPayload, syncScheduleRecordToPayload } from "@/lib/app-sync-runs";
import { normalizeCurrencyCode } from "@/lib/currency";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import {
  ensureAppSyncSchedule,
  getLatestAppSyncRun,
  listEvidenceLinks,
  listAppSyncRuns,
  listSourceItems
} from "@/lib/db/finance-db";
import { activeEmbeddingModel } from "@/lib/embeddings";
import { getEffectiveLlmEnrichmentStatus } from "@/lib/enrichment-runs";
import { maskLlmStatusForPublicDemo } from "@/lib/public-demo";
import { isHostedAuthMode } from "@/lib/auth";
import { isEnrichmentProviderReady } from "@/lib/llm-enrichment";
import { getFinanceData } from "@/lib/finance-data";
import { ACCENT_COOKIE, parseAccent } from "@/lib/accent-color";
import { FONT_CHOICE_COOKIE, parseFontChoice } from "@/lib/font-choice";
import { MONEY_COLORS_COOKIE, parseMoneyColors } from "@/lib/money-colors";
import { getPlaidSetupStatus } from "@/lib/plaid-server";
import { getSourceAdapterDiagnostics, summarizeSourceReadiness } from "@/lib/source-adapters";
import { compactSourcePreviewSummary, compactSourcePreviewTitle } from "@/lib/source-preview";
import { getSimpleFinSetupStatus } from "@/lib/simplefin-server";
import { getFinanceKitSetupStatus } from "@/lib/financekit-server";
import { getSnapTradeSetupStatus } from "@/lib/snaptrade-server";

export default async function SettingsPage() {
  const demoModeEnabled = await isDemoModeEnabled();
  const cookieStore = await cookies();
  const moneyColors = parseMoneyColors(cookieStore.get(MONEY_COLORS_COOKIE)?.value);
  const fontChoice = parseFontChoice(cookieStore.get(FONT_CHOICE_COOKIE)?.value);
  const accent = parseAccent(cookieStore.get(ACCENT_COOKIE)?.value);
  const [
    financeData,
    snapTradeStatus,
    plaidStatus,
    simpleFinStatus,
    financeKitStatus,
    sourceDiagnostics,
    llmProvider,
    latestAppSyncRun,
    recentAppSyncRuns,
    appSyncSchedule,
    sourceItems,
    evidenceLinks
  ] = await Promise.all([
    getFinanceData(),
    getSnapTradeSetupStatus(),
    getPlaidSetupStatus(),
    getSimpleFinSetupStatus(),
    getFinanceKitSetupStatus(),
    getSourceAdapterDiagnostics(),
    getEffectiveLlmEnrichmentStatus().then((status) => maskLlmStatusForPublicDemo(status)),
    getLatestAppSyncRun(),
    listAppSyncRuns(5),
    ensureAppSyncSchedule(),
    listSourceItems({ limit: 12 }),
    listEvidenceLinks({ limit: 12, status: "suggested" })
  ]);
  const embeddingProvider = activeEmbeddingModel();
  const sourceReadiness = summarizeSourceReadiness(sourceDiagnostics);
  const syncSchedulePayload = toSerializable(syncScheduleRecordToPayload(appSyncSchedule));
  const syncStatusPayload = toSerializable({
    enrichment: {
      llm_provider: {
        configured: llmProvider.configured,
        credential_source: llmProvider.credentialSource,
        error_message: llmProvider.errorMessage,
        model: llmProvider.model,
        provider: llmProvider.provider,
        status: llmProvider.status
      }
    },
    ready: {
      enrichment: isEnrichmentProviderReady(llmProvider),
      plaid: plaidStatus.readyForSync,
      simplefin: simpleFinStatus.readyForSync,
      sources: sourceReadiness.ready,
      snaptrade: snapTradeStatus.readyForSync
    },
    sources: {
      blocked_count: sourceReadiness.blockedCount,
      external_source_count: sourceDiagnostics.summary.externalSourceCount,
      installed_count: sourceReadiness.installedCount,
      ready_count: sourceReadiness.readyCount,
      source_item_count: sourceDiagnostics.summary.sourceItemCount
    },
    snaptrade: {
      configured: snapTradeStatus.configured,
      connection_count: snapTradeStatus.connectionCount,
      last_synced_at: snapTradeStatus.lastSyncedAt,
      ready_for_sync: snapTradeStatus.readyForSync,
      registered: snapTradeStatus.registered,
      stored_account_count: snapTradeStatus.storedAccountCount,
      stored_position_count: snapTradeStatus.storedPositionCount
    },
    plaid: {
      configured: plaidStatus.configured,
      item_count: plaidStatus.itemCount,
      last_synced_at: plaidStatus.lastSyncedAt,
      ready_for_sync: plaidStatus.readyForSync,
      standby_institution_names: plaidStatus.standbyInstitutionNames,
      stored_account_count: plaidStatus.storedAccountCount,
      stored_transaction_count: plaidStatus.storedTransactionCount
    },
    simplefin: {
      configured: simpleFinStatus.configured,
      connection_count: simpleFinStatus.connectionCount,
      last_errors: simpleFinStatus.lastErrors,
      last_synced_at: simpleFinStatus.lastSyncedAt,
      latest_balance_as_of: simpleFinStatus.latestBalanceAsOf,
      ready_for_sync: simpleFinStatus.readyForSync,
      stored_account_count: simpleFinStatus.storedAccountCount,
      stored_transaction_count: simpleFinStatus.storedTransactionCount
    },
    last_run: latestAppSyncRun ? appSyncRunRecordToPayload(latestAppSyncRun) : null,
    recent_runs: recentAppSyncRuns.map(appSyncRunRecordToPayload)
  });
  const aiProviderPayload = toSerializable({
    base_url: llmProvider.baseUrl,
    chatgpt_oauth_connected: llmProvider.chatGptOAuthConnected,
    chatgpt_oauth_enabled: llmProvider.chatGptOAuthEnabled,
    configured: llmProvider.configured,
    credential_source: llmProvider.credentialSource,
    embedding: {
      dimensions: embeddingProvider.dims,
      model: embeddingProvider.model,
      provider: embeddingProvider.provider,
      sends_text_to_provider: embeddingProvider.provider === "voyage"
    },
    error_message: llmProvider.errorMessage,
    model: llmProvider.model,
    provider: llmProvider.provider,
    status: llmProvider.status,
    timeout_ms: llmProvider.timeoutMs
  });
  const sourceAdapterPayload = toSerializable(
    sourceDiagnostics.adapters.map((adapter) => ({
      authCommand: adapter.authCommand,
      binary: adapter.binary,
      cache: adapter.cache
        ? {
            path: adapter.cache.path,
            recordCount: adapter.cache.recordCount,
            status: adapter.cache.status,
            summary: adapter.cache.summary
          }
        : undefined,
      displayName: adapter.displayName,
      errorMessage: adapter.errorMessage,
      evidenceKinds: adapter.evidenceKinds,
      id: adapter.id,
      installCommand: adapter.installCommand,
      installed: adapter.installed,
      lastSyncedAt: adapter.lastSyncedAt,
      refreshMessage: adapter.refreshMessage,
      role: adapter.role,
      setup: {
        commands: adapter.setup.commands.map((command) => ({
          command: command.command,
          kind: command.kind,
          label: command.label
        })),
        missing: adapter.setup.missing,
        nextAction: adapter.setup.nextAction,
        ready: adapter.setup.ready
      },
      setupSteps: adapter.setupSteps,
      status: adapter.status,
      storage: {
        evidenceLinkCount: adapter.storage.evidenceLinkCount,
        lastImportedAt: adapter.storage.lastImportedAt,
        latestOccurredAt: adapter.storage.latestOccurredAt,
        sourceItemCount: adapter.storage.sourceItemCount
      },
      webAuth: adapter.webAuth
        ? {
            accountEmail: adapter.webAuth.accountEmail,
            accountName: adapter.webAuth.accountName,
            configured: adapter.webAuth.configured,
            connected: adapter.webAuth.connected,
            startPath: adapter.webAuth.startPath,
            statusPath: adapter.webAuth.statusPath
          }
        : undefined,
      syncCommand: adapter.syncCommand
    }))
  );
  const initialEvidenceLinks = toSerializable(
    evidenceLinks.map((evidence) => ({
      confidence: evidence.confidence,
      createdAt: evidence.createdAt,
      relationship: evidence.relationship,
      sourceItem: {
        amount: evidence.sourceItem.amount,
        currency: normalizeCurrencyCode(evidence.sourceItem.currency),
        externalId: evidence.sourceItem.externalId,
        id: evidence.sourceItem.id,
        kind: evidence.sourceItem.kind,
        merchantName: evidence.sourceItem.merchantName,
        occurredAt: evidence.sourceItem.occurredAt,
        sourceId: evidence.sourceItem.sourceId,
        summary: compactSourcePreviewSummary(evidence.sourceItem.summary),
        title: compactSourcePreviewTitle(evidence.sourceItem.title)
      },
      status: evidence.status,
      transaction: {
        amount: evidence.transaction.amount,
        currency: evidence.transaction.currency,
        date: evidence.transaction.date,
        description: evidence.transaction.description,
        id: evidence.transaction.id,
        merchantName: evidence.transaction.merchantName
      },
      transactionId: evidence.transactionId
    }))
  );
  const initialSourceItems = toSerializable(
    sourceItems.map((item) => ({
      amount: item.amount,
      currency: normalizeCurrencyCode(item.currency),
      externalId: item.externalId,
      id: item.id,
      kind: item.kind,
      merchantName: item.merchantName,
      occurredAt: item.occurredAt,
      sourceId: item.sourceId,
      summary: compactSourcePreviewSummary(item.summary),
      title: compactSourcePreviewTitle(item.title)
    }))
  );
  const sourceSummaryPayload = toSerializable({
    evidenceLinkCount: sourceDiagnostics.summary.evidenceLinkCount,
    externalSourceCount: sourceDiagnostics.summary.externalSourceCount,
    sourceItemCount: sourceDiagnostics.summary.sourceItemCount
  });
  const snapTradeStatusPayload = toSerializable(snapTradeStatus);
  const plaidStatusPayload = toSerializable(plaidStatus);
  const simpleFinStatusPayload = toSerializable(simpleFinStatus);
  const financeKitStatusPayload = toSerializable(financeKitStatus);
  const providerConnectionsPayload = toSerializable(financeData.providerConnections);
  const accountCountByConnection = toSerializable(
    Object.fromEntries(
      financeData.providerConnections.map((connection) => [
        connection.id,
        financeData.accounts.filter((account) => account.providerConnectionId === connection.id).length
      ])
    )
  );
  const hostedAuth = isHostedAuthMode();

  return (
    <SettingsView
      accountCountByConnection={accountCountByConnection}
      aiProvider={aiProviderPayload}
      demoModeEnabled={demoModeEnabled}
      evidenceLinks={initialEvidenceLinks}
      financeKitStatus={financeKitStatusPayload}
      hostedAuth={hostedAuth}
      accent={accent}
      fontChoice={fontChoice}
      moneyColors={moneyColors}
      plaidStatus={plaidStatusPayload}
      providerConnections={providerConnectionsPayload}
      simpleFinStatus={simpleFinStatusPayload}
      snapTradeStatus={snapTradeStatusPayload}
      sourceAdapters={sourceAdapterPayload}
      sourceItems={initialSourceItems}
      sourceSummary={sourceSummaryPayload}
      syncSchedule={syncSchedulePayload}
      syncStatus={syncStatusPayload}
      transactionCount={financeData.transactions.length}
    />
  );
}

function toSerializable<T>(value: T): T {
  return structuredClone(value);
}
