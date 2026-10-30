import Link from "next/link";

import { AppearanceSettingsPanel } from "@/components/appearance-settings-panel";
import { ApiTokensPanel } from "@/components/api-tokens-panel";
import { ConnectionsSettings } from "@/components/connections-settings";
import { DemoModePanel } from "@/components/demo-mode-panel";
import { LocalDataPanel } from "@/components/local-data-panel";
import { UiModeSettingsPanel } from "@/components/quiet/ui-mode-toggle";
import { SecuritySettingsPanel } from "@/components/security-settings-panel";
import { SourceAdaptersPanel } from "@/components/source-adapters-panel";
import { SoundSettingsPanel } from "@/components/sound-settings-panel";
import { AiProviderPanel, SyncEverythingPanel } from "@/components/sync-everything-panel";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Presentation for /settings. The page keeps every await, every provider status
 * probe, and the serialization pass; this holds only the layout.
 *
 * Prop types are derived from the consuming components rather than restated.
 * The payloads reach here through a generic `toSerializable<T>(value: T): T`,
 * so their shapes are inferred from provider status probes — writing them out
 * by hand would silently drift the first time one of those probes changes.
 */
export interface SettingsViewProps {
  accountCountByConnection: React.ComponentProps<typeof ConnectionsSettings>["accountCountByConnection"];
  aiProvider: React.ComponentProps<typeof AiProviderPanel>["initialProvider"];
  demoModeEnabled: React.ComponentProps<typeof DemoModePanel>["initialEnabled"];
  evidenceLinks: React.ComponentProps<typeof SourceAdaptersPanel>["initialEvidenceLinks"];
  financeKitStatus: React.ComponentProps<typeof ConnectionsSettings>["financeKitStatus"];
  hostedAuth: React.ComponentProps<typeof SecuritySettingsPanel>["hostedAuth"];
  plaidStatus: React.ComponentProps<typeof ConnectionsSettings>["plaidStatus"];
  providerConnections: React.ComponentProps<typeof ConnectionsSettings>["providerConnections"];
  simpleFinStatus: React.ComponentProps<typeof ConnectionsSettings>["simpleFinStatus"];
  snapTradeStatus: React.ComponentProps<typeof ConnectionsSettings>["snapTradeStatus"];
  sourceAdapters: React.ComponentProps<typeof SourceAdaptersPanel>["initialAdapters"];
  sourceItems: React.ComponentProps<typeof SourceAdaptersPanel>["initialSourceItems"];
  sourceSummary: React.ComponentProps<typeof SourceAdaptersPanel>["initialSummary"];
  syncSchedule: React.ComponentProps<typeof SyncEverythingPanel>["initialSchedule"];
  accent: React.ComponentProps<typeof AppearanceSettingsPanel>["initialAccent"];
  fontChoice: React.ComponentProps<typeof AppearanceSettingsPanel>["initialFontChoice"];
  moneyColors: React.ComponentProps<typeof AppearanceSettingsPanel>["initialMoneyColors"];
  syncStatus: React.ComponentProps<typeof SyncEverythingPanel>["initialStatus"];
  transactionCount: React.ComponentProps<typeof LocalDataPanel>["initialTransactionCount"];
}

export function SettingsView({
  accent,
  accountCountByConnection,
  aiProvider,
  demoModeEnabled,
  evidenceLinks,
  financeKitStatus,
  fontChoice,
  hostedAuth,
  moneyColors,
  plaidStatus,
  providerConnections,
  simpleFinStatus,
  snapTradeStatus,
  sourceAdapters,
  sourceItems,
  sourceSummary,
  syncSchedule,
  syncStatus,
  transactionCount
}: SettingsViewProps) {
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
            financeKitStatus={financeKitStatus}
            plaidStatus={plaidStatus}
            providerConnections={providerConnections}
            simpleFinStatus={simpleFinStatus}
            snapTradeStatus={snapTradeStatus}
          />
          <SourceAdaptersPanel
            initialAdapters={sourceAdapters}
            initialEvidenceLinks={evidenceLinks}
            initialSourceItems={sourceItems}
            initialSummary={sourceSummary}
          />
        </TabsContent>

        <TabsContent value="sync-ai" className="flex flex-col gap-5">
          <SyncEverythingPanel initialSchedule={syncSchedule} initialStatus={syncStatus} />
          <AiProviderPanel initialProvider={aiProvider} />
        </TabsContent>

        <TabsContent value="security" className="flex flex-col gap-5">
          <SecuritySettingsPanel hostedAuth={hostedAuth} />
          <ApiTokensPanel hostedAuth={hostedAuth} />
        </TabsContent>

        <TabsContent value="data" className="flex flex-col gap-5">
          <DemoModePanel initialEnabled={demoModeEnabled} />
          <AppearanceSettingsPanel
            initialAccent={accent}
            initialFontChoice={fontChoice}
            initialMoneyColors={moneyColors}
          />
          <UiModeSettingsPanel />
          <SoundSettingsPanel />
          <LocalDataPanel initialTransactionCount={transactionCount} />
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
