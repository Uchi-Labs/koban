import { AppearanceSettingsPanel } from "@/components/appearance-settings-panel";
import { ApiTokensPanel } from "@/components/api-tokens-panel";
import { AiProviderPanel } from "@/components/sync-everything-panel";
import { ConnectionsSettings } from "@/components/connections-settings";
import { DemoModePanel } from "@/components/demo-mode-panel";
import Link from "next/link";
import { LocalDataPanel } from "@/components/local-data-panel";
import { SecuritySettingsPanel } from "@/components/security-settings-panel";
import { SourceAdaptersPanel } from "@/components/source-adapters-panel";
import { SoundSettingsPanel } from "@/components/sound-settings-panel";
import { SyncEverythingPanel } from "@/components/sync-everything-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/motion/theme-toggle";
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
import { isHostedAuthMode } from "@/lib/auth";
import { isEnrichmentProviderReady } from "@/lib/llm-enrichment";
import { getFinanceData } from "@/lib/finance-data";
import { getPlaidSetupStatus } from "@/lib/plaid-server";
import { getSourceAdapterDiagnostics, summarizeSourceReadiness } from "@/lib/source-adapters";
import { compactSourcePreviewSummary, compactSourcePreviewTitle } from "@/lib/source-preview";
import { getSimpleFinSetupStatus } from "@/lib/simplefin-server";
import { getFinanceKitSetupStatus } from "@/lib/financekit-server";
import { getSnapTradeSetupStatus } from "@/lib/snaptrade-server";

export default async function SettingsPage() {
  const demoModeEnabled = await isDemoModeEnabled();
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
    getEffectiveLlmEnrichmentStatus(),
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
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 sm:p-6" data-testid="settings-page">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="app-page-title">Settings</h1>
          <p className="app-page-description">
            Connect banks and context sources, control syncing, and manage local data.
          </p>
        </div>
        <ThemeToggle
          className="size-8 shrink-0 rounded-full border border-border bg-card text-foreground shadow-xs transition-colors hover:bg-muted motion-reduce:transition-none"
          iconClassName="size-4"
          start="top-right"
          variant="circle-blur"
        />
      </header>

      <Tabs defaultValue="connections" className="gap-5">
        <TabsList variant="buttons" className="justify-start">
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="sync-ai">Sync &amp; AI</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="flex flex-col gap-5">
          <ConnectionsSettings
            accountCountByConnection={accountCountByConnection}
            financeKitStatus={financeKitStatusPayload}
            plaidStatus={plaidStatusPayload}
            providerConnections={providerConnectionsPayload}
            simpleFinStatus={simpleFinStatusPayload}
            snapTradeStatus={snapTradeStatusPayload}
          />
          <SourceAdaptersPanel
            initialAdapters={sourceAdapterPayload}
            initialEvidenceLinks={initialEvidenceLinks}
            initialSourceItems={initialSourceItems}
            initialSummary={sourceSummaryPayload}
          />
        </TabsContent>

        <TabsContent value="sync-ai" className="flex flex-col gap-5">
          <SyncEverythingPanel initialSchedule={syncSchedulePayload} initialStatus={syncStatusPayload} />
          <AiProviderPanel initialProvider={aiProviderPayload} />
        </TabsContent>

        <TabsContent value="security" className="flex flex-col gap-5">
          <SecuritySettingsPanel hostedAuth={hostedAuth} />
          <ApiTokensPanel hostedAuth={hostedAuth} />
        </TabsContent>

        <TabsContent value="data" className="flex flex-col gap-5">
          <DemoModePanel initialEnabled={demoModeEnabled} />
          <AppearanceSettingsPanel />
          <SoundSettingsPanel />
          <LocalDataPanel initialTransactionCount={financeData.transactions.length} />
        </TabsContent>
      </Tabs>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        <Link className="underline-offset-4 hover:underline" href="/privacy">
          Koban Privacy Policy
        </Link>
      </footer>
    </main>
  );
}

function toSerializable<T>(value: T): T {
  return structuredClone(value);
}
