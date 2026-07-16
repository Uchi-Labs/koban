"use client";

import { Copy, CopyCheck } from "lucide-react";
import { useState } from "react";
import { ProviderStatusBadge } from "@/components/provider-status-badge";
import { Button } from "@/components/ui/button";
import { ActionSwapCascadeIcon, ActionSwapCascadeText } from "@/components/ui/action-swap-cascade";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  SetupChecklist,
  SetupChecklistCard,
  SetupChecklistDescription,
  SetupChecklistHeader,
  SetupChecklistItem,
  SetupChecklistList,
  SetupChecklistTitle
} from "@/components/ui/setup-checklist";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { normalizeCurrencyCode } from "@/lib/currency";
import { formatCurrency } from "@/lib/format";
import { isSourceImportTooLarge, sourceImportLimitLabel, sourceImportTooLargeMessage } from "@/lib/source-import-limits";
import { compactSourcePreviewSummary, compactSourcePreviewTitle } from "@/lib/source-preview";
import { cn } from "@/lib/utils";

interface SourceSummary {
  evidenceLinkCount: number;
  externalSourceCount: number;
  sourceItemCount: number;
}

interface SourceAdapterView {
  authCommand?: string;
  binary: string;
  cache?: {
    path?: string;
    recordCount: number;
    status: "empty" | "has_records" | "missing" | "unreadable" | "unknown";
    summary: string;
  };
  displayName: string;
  errorMessage?: string;
  evidenceKinds: string[];
  id: string;
  installCommand: string;
  installed: boolean;
  lastSyncedAt?: string;
  refreshMessage?: string;
  role: string;
  setup: {
    commands: Array<{
      command: string;
      kind: "auth" | "backfill" | "install" | "manual" | "sync";
      label: string;
    }>;
    missing: string[];
    nextAction: string;
    ready: boolean;
  };
  setupSteps: string[];
  status: "not_configured" | "connected" | "syncing" | "stale" | "error";
  storage: {
    evidenceLinkCount: number;
    lastImportedAt?: string;
    latestOccurredAt?: string;
    sourceItemCount: number;
  };
  syncCommand: string;
  webAuth?: {
    accountEmail?: string;
    accountName?: string;
    configured: boolean;
    connected: boolean;
    startPath: string;
    statusPath: string;
  };
}

interface SourceItemView {
  amount?: number;
  currency?: string;
  externalId: string;
  id: string;
  kind: string;
  merchantName?: string;
  occurredAt?: string;
  sourceId: string;
  summary: string;
  title: string;
}

interface EvidenceReviewView {
  confidence: number;
  createdAt: string;
  relationship: string;
  sourceItem: SourceItemView;
  status: "accepted" | "dismissed" | "suggested";
  transaction: {
    amount: number;
    currency: string;
    date: string;
    description: string;
    id: string;
    merchantName: string;
  };
  transactionId: string;
}

interface SourcesApiResponse {
  data: Array<{
    auth_command?: string;
    binary: string;
    cache?: {
      path?: string;
      record_count: number;
      status: NonNullable<SourceAdapterView["cache"]>["status"];
      summary: string;
    };
    display_name: string;
    error_message?: string;
    evidence_kinds: string[];
    id: string;
    install_command: string;
    installed: boolean;
    last_synced_at?: string;
    refresh_message?: string;
    role: string;
    setup: {
      commands: Array<{
        command: string;
        kind: SourceAdapterView["setup"]["commands"][number]["kind"];
        label: string;
      }>;
      missing: string[];
      next_action: string;
      ready: boolean;
    };
    setup_steps: string[];
    status: SourceAdapterView["status"];
    storage: {
      evidence_link_count: number;
      last_imported_at?: string;
      latest_occurred_at?: string;
      source_item_count: number;
    };
    sync_command: string;
    web_auth?: {
      account_email?: string;
      account_name?: string;
      configured: boolean;
      connected: boolean;
      start_path: string;
      status_path: string;
    };
  }>;
  summary: SourceSummary;
}

interface SourceItemsApiResponse {
  data: Array<{
    amount?: number | null;
    currency?: string | null;
    external_id: string;
    id: string;
    kind: string;
    merchant_name?: string;
    occurred_at?: string;
    source_id: string;
    summary: string;
    title: string;
  }>;
}

interface EvidenceApiResponse {
  data: Array<{
    confidence: number;
    created_at: string;
    relationship: string;
    source_item: {
      amount?: number | null;
      currency?: string | null;
      external_id: string;
      id: string;
      kind: string;
      merchant_name?: string;
      occurred_at?: string;
      source_id: string;
      summary: string;
      title: string;
    };
    status: EvidenceReviewView["status"];
    transaction: {
      amount: number;
      currency: string;
      date: string;
      description: string;
      id: string;
      merchant_name: string;
    };
    transaction_id: string;
  }>;
}

const sourceDecimalFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2
});
const sourceCurrencyFormatters = new Map<string, Intl.NumberFormat>();

interface SourceAdaptersPanelProps {
  initialAdapters: SourceAdapterView[];
  initialEvidenceLinks: EvidenceReviewView[];
  initialSourceItems: SourceItemView[];
  initialSummary: SourceSummary;
}

export function SourceAdaptersPanel(props: SourceAdaptersPanelProps) {
  const model = useSourceAdaptersModel(props);
  return <SourceAdaptersLayout model={model} />;
}

function useSourceAdaptersModel({
  initialAdapters,
  initialEvidenceLinks,
  initialSourceItems,
  initialSummary
}: SourceAdaptersPanelProps) {
  const [adapters, setAdapters] = useState(initialAdapters);
  const [evidenceLinks, setEvidenceLinks] = useState(initialEvidenceLinks);
  const [evidenceLinksLoading, setEvidenceLinksLoading] = useState(false);
  const [sourceItems, setSourceItems] = useState(initialSourceItems);
  const [sourceItemFilter, setSourceItemFilter] = useState("all");
  const [sourceItemsLoading, setSourceItemsLoading] = useState(false);
  const [summary, setSummary] = useState(initialSummary);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const [importingSourceId, setImportingSourceId] = useState<string | null>(null);
  const [pastedImports, setPastedImports] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [copiedCommand, setCopiedCommand] = useState("");
  const { showToast, updateToast } = useToast();
  const blockedAdapters = adapters.filter((adapter) => !adapter.setup.ready);
  const actionsBusy = syncingAll || syncingSourceId !== null || importingSourceId !== null;

  async function refreshSources() {
    const response = await fetch("/api/v1/sources", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Unable to refresh source adapters.");
    }

    const body = (await response.json()) as SourcesApiResponse;
    setAdapters(body.data.map(adapterFromApi));
    setSummary(body.summary);
  }

  async function refreshSourceItems(nextFilter = sourceItemFilter) {
    setSourceItemsLoading(true);

    try {
      const params = new URLSearchParams({ limit: "12" });

      if (nextFilter !== "all") {
        params.set("source_id", nextFilter);
      }

      const response = await fetch(`/api/v1/source-items?${params.toString()}`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Unable to refresh imported source items.");
      }

      const body = (await response.json()) as SourceItemsApiResponse;
      setSourceItems(body.data.map(sourceItemFromApi));
    } catch {
      setSourceItems([]);
    } finally {
      setSourceItemsLoading(false);
    }
  }

  async function refreshEvidenceLinks() {
    setEvidenceLinksLoading(true);

    try {
      const response = await fetch("/api/v1/evidence?status=suggested&limit=12", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Unable to refresh evidence suggestions.");
      }

      const body = (await response.json()) as EvidenceApiResponse;
      setEvidenceLinks(body.data.map(evidenceFromApi));
    } catch {
      setEvidenceLinks([]);
    } finally {
      setEvidenceLinksLoading(false);
    }
  }

  async function syncSource(sourceId: string) {
    setSyncingSourceId(sourceId);
    setMessage("");
    const adapter = adapters.find((candidate) => candidate.id === sourceId);
    const toastId = showToast({
      description: adapter ? `Syncing ${adapter.displayName}.` : "Syncing source adapter.",
      duration: 0,
      status: "loading",
      title: "Source sync started",
    });

    try {
      const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/sync-runs`, {
        method: "POST"
      });
      const body = (await response.json()) as {
        adapter?: { errorMessage?: string; refreshMessage?: string; status?: SourceAdapterView["status"] };
        evidenceLinksSuggested?: number;
        error?: string;
        errorMessage?: string;
        itemsWritten?: number;
        runStatus?: "succeeded" | "error";
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Source sync failed.");
      }

      await Promise.all([refreshSources(), refreshSourceItems(), refreshEvidenceLinks()]);
      const adapterMessage = body.adapter?.errorMessage ?? body.adapter?.refreshMessage ?? body.errorMessage;

      if (body.runStatus === "error") {
        const nextMessage = adapterMessage ?? "Source sync failed.";
        setMessage(nextMessage);
        updateToast(toastId, {
          description: nextMessage,
          duration: 5200,
          status: "error",
          title: "Source sync failed",
        });
      } else if (adapterMessage) {
        const nextMessage = `Source sync checked. ${adapterMessage}`;
        setMessage(nextMessage);
        updateToast(toastId, {
          description: nextMessage,
          duration: 4200,
          status: "info",
          title: "Source sync checked",
        });
      } else {
        const nextMessage = `Source sync finished. Items written: ${body.itemsWritten ?? 0}. Evidence suggestions: ${body.evidenceLinksSuggested ?? 0}.`;
        setMessage(nextMessage);
        updateToast(toastId, {
          description: nextMessage,
          duration: 3600,
          status: "success",
          title: "Source sync finished",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Source sync failed.";
      setMessage(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Source sync failed",
      });
      await Promise.all([refreshSources(), refreshSourceItems(), refreshEvidenceLinks()]).catch(() => undefined);
    } finally {
      setSyncingSourceId(null);
    }
  }

  async function syncInstalledSources() {
    const sourceIds = adapters.flatMap((adapter) => (adapter.installed ? [adapter.id] : []));

    if (sourceIds.length === 0 || syncingAll || syncingSourceId !== null || importingSourceId !== null) {
      return;
    }

    setSyncingAll(true);
    setMessage("");
    const toastId = showToast({
      description: `Syncing ${sourceIds.length.toLocaleString()} installed sources.`,
      duration: 0,
      status: "loading",
      title: "Source sync started",
    });

    try {
      const response = await fetch("/api/v1/sources/sync-runs", {
        body: JSON.stringify({ source_ids: sourceIds }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const body = (await response.json()) as {
        error?: string;
        summary?: {
          evidenceLinksSuggested: number;
          itemsWritten: number;
          sourcesAttempted: number;
          sourcesErrored: number;
          sourcesStale: number;
        };
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Source sync failed.");
      }

      await Promise.all([refreshSources(), refreshSourceItems(), refreshEvidenceLinks()]);
      const sourcesErrored = body.summary?.sourcesErrored ?? 0;
      const sourcesStale = body.summary?.sourcesStale ?? 0;
      const syncVerb = sourcesErrored > 0 || sourcesStale > 0 ? "checked" : "finished";
      const syncSuffix =
        sourcesErrored > 0 || sourcesStale > 0 ? ` Errors: ${sourcesErrored}. Stale: ${sourcesStale}.` : "";
      const nextMessage = `Source sync ${syncVerb}. Sources checked: ${body.summary?.sourcesAttempted ?? sourceIds.length}. Items written: ${body.summary?.itemsWritten ?? 0}. Evidence suggestions: ${body.summary?.evidenceLinksSuggested ?? 0}.${syncSuffix}`;
      setMessage(nextMessage);
      updateToast(toastId, {
        description: nextMessage,
        duration: sourcesErrored > 0 ? 5200 : 3600,
        status: sourcesErrored > 0 ? "error" : sourcesStale > 0 ? "info" : "success",
        title: `Source sync ${syncVerb}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Source sync failed.";
      setMessage(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Source sync failed",
      });
      await Promise.all([refreshSources(), refreshSourceItems(), refreshEvidenceLinks()]).catch(() => undefined);
    } finally {
      setSyncingAll(false);
    }
  }

  async function importSourceFile(sourceId: string, file: File | undefined, dryRun = false) {
    if (!file || importingSourceId !== null || syncingSourceId !== null) {
      return;
    }

    if (isSourceImportTooLarge(file.size)) {
      setMessage(sourceImportTooLargeMessage());
      return;
    }

    const formData = new FormData();
    formData.append("file", file, file.name);

    if (dryRun) {
      formData.append("dry_run", "true");
    }

    await importSourceRequest(sourceId, {
      body: formData,
      method: "POST"
    });
  }

  async function validateSourceFile(sourceId: string, file: File | undefined) {
    await importSourceFile(sourceId, file, true);
  }

  async function importPastedSource(sourceId: string) {
    if (importingSourceId !== null || syncingSourceId !== null) {
      return;
    }

    const content = pastedImports[sourceId] ?? "";

    if (!content.trim()) {
      setMessage("Paste JSON, JSONL, CSV, EML, MBOX, or ICS source records before importing.");
      return;
    }

    await importSourceContent(sourceId, content, `${sourceId}-pasted.jsonl`);
    setPastedImports((current) => ({ ...current, [sourceId]: "" }));
  }

  async function validatePastedSource(sourceId: string) {
    if (importingSourceId !== null || syncingSourceId !== null) {
      return;
    }

    const content = pastedImports[sourceId] ?? "";

    if (!content.trim()) {
      setMessage("Paste JSON, JSONL, CSV, EML, MBOX, or ICS source records before validating.");
      return;
    }

    await importSourceContent(sourceId, content, `${sourceId}-pasted.jsonl`, true);
  }

  async function importSourceContent(sourceId: string, content: string, filename: string, dryRun = false) {
    await importSourceRequest(sourceId, {
      body: JSON.stringify({
        content,
        ...(dryRun ? { dry_run: true } : {}),
        filename
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  }

  async function importSourceRequest(sourceId: string, requestInit: RequestInit) {
    setImportingSourceId(sourceId);
    setMessage("");

    try {
      const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/imports`, requestInit);
      const body = (await response.json()) as {
        adapter?: { errorMessage?: string; refreshMessage?: string; status?: SourceAdapterView["status"] };
        data?: Array<{ title?: string }>;
        evidenceLinksSuggested?: number;
        error?: string;
        errorMessage?: string;
        error_message?: string;
        item_count?: number;
        itemsWritten?: number;
        object?: string;
        runStatus?: "succeeded" | "error";
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Source import failed.");
      }

      if (body.object === "source_import_preview") {
        const previewTitle = body.data?.[0]?.title;
        const suffix = previewTitle ? ` First match: ${previewTitle}.` : "";
        setMessage(
          body.error_message
            ? `Source import preview found 0 records. ${body.error_message}`
            : `Source import preview found ${body.item_count ?? 0} normalized records.${suffix}`
        );
        return;
      }

      await Promise.all([refreshSources(), refreshSourceItems(), refreshEvidenceLinks()]);
      const adapterMessage = body.adapter?.errorMessage ?? body.adapter?.refreshMessage ?? body.errorMessage;

      if (body.runStatus === "error") {
        setMessage(adapterMessage ?? "Source import failed.");
      } else if (adapterMessage) {
        setMessage(`Source import checked. ${adapterMessage}`);
      } else {
        setMessage(
          `Source import finished. Items written: ${body.itemsWritten ?? 0}. Evidence suggestions: ${body.evidenceLinksSuggested ?? 0}.`
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Source import failed.");
      await Promise.all([refreshSources(), refreshSourceItems(), refreshEvidenceLinks()]).catch(() => undefined);
    } finally {
      setImportingSourceId(null);
    }
  }

  async function updateEvidenceStatus(evidence: EvidenceReviewView, status: "accepted" | "dismissed") {
    setMessage(status === "accepted" ? "Accepting evidence..." : "Dismissing evidence...");
    const toastId = showToast({
      description: status === "accepted" ? evidence.sourceItem.title : "Dismissing suggested evidence.",
      duration: 0,
      status: "loading",
      title: status === "accepted" ? "Accepting evidence" : "Dismissing evidence",
    });

    try {
      const response = await fetch(
        `/api/v1/transactions/${encodeURIComponent(evidence.transactionId)}/evidence/${encodeURIComponent(evidence.sourceItem.id)}`,
        {
          body: JSON.stringify({
            relationship: evidence.relationship,
            status
          }),
          headers: {
            "Content-Type": "application/json"
          },
          method: "PATCH"
        }
      );
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to update evidence.");
      }

      setEvidenceLinks((current) =>
        current.filter(
          (item) =>
            !(
              item.transactionId === evidence.transactionId &&
              item.sourceItem.id === evidence.sourceItem.id &&
              item.relationship === evidence.relationship
            )
        )
      );
      await refreshSources();
      const nextMessage = status === "accepted" ? "Evidence accepted." : "Evidence dismissed.";
      setMessage(nextMessage);
      updateToast(toastId, {
        description: nextMessage,
        duration: 3600,
        status: "success",
        title: status === "accepted" ? "Evidence accepted" : "Evidence dismissed",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unable to update evidence.";
      setMessage(errorMessage);
      updateToast(toastId, {
        description: errorMessage,
        duration: 5200,
        status: "error",
        title: "Evidence update failed",
      });
    }
  }

  async function copySetupCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage("Setup command copied.");
      setCopiedCommand(command);
      window.setTimeout(() => {
        setCopiedCommand((current) => (current === command ? "" : current));
      }, 1400);
    } catch {
      setMessage(command);
    }
  }

  const fileInputAccept =
    ".json,.jsonl,.csv,.eml,.mbox,.ics,.ical,.zip,application/json,application/x-ndjson,text/csv,message/rfc822,text/calendar,application/zip,application/x-zip-compressed,text/plain";

  return {
    actionsBusy,
    adapters,
    blockedAdapters,
    evidenceLinks,
    evidenceLinksLoading,
    fileInputAccept,
    importingSourceId,
    message,
    pastedImports,
    sourceItemFilter,
    sourceItems,
    sourceItemsLoading,
    summary,
    syncingAll,
    syncingSourceId,
    copiedCommand,
    copySetupCommand,
    importPastedSource,
    importSourceFile,
    refreshEvidenceLinks,
    refreshSourceItems,
    setPastedImports,
    setSourceItemFilter,
    syncInstalledSources,
    syncSource,
    updateEvidenceStatus,
    validatePastedSource,
    validateSourceFile
  };
}

type SourceAdaptersModel = ReturnType<typeof useSourceAdaptersModel>;

function SourceAdaptersLayout({ model }: { model: SourceAdaptersModel }) {
  return (
    <Card size="sm">
      <CardHeader className="border-b pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Context sources</h2>
          <p className="text-sm text-muted-foreground">
            Source adapters enrich transactions with receipt, order, grocery, email, and travel context without
            replacing the local ledger.
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <SourceSummaryActions model={model} />
        <SourceSetupChecklist model={model} />
        <ImportedSourceItems model={model} />
        <SuggestedEvidenceMatches model={model} />
        <Separator />
        <SourceAdapterList model={model} />
        {model.message ? <p className="text-sm text-muted-foreground">{model.message}</p> : null}
      </CardContent>
    </Card>
  );
}

function SourceSummaryActions({ model }: { model: SourceAdaptersModel }) {
  const blockedSetupCommand = model.blockedAdapters
    .flatMap((adapter) => {
      const command = nextSetupCommand(adapter);
      return command ? [command] : [];
    })
    .join("\n");

  return (
    <>
      <div className="grid grid-cols-3 gap-2" aria-label="Evidence source store summary">
        <SummaryTile label="Sources" value={model.summary.externalSourceCount} />
        <SummaryTile label="Source items" value={model.summary.sourceItemCount} />
        <SummaryTile label="Evidence links" value={model.summary.evidenceLinkCount} />
      </div>
      <div className="flex flex-wrap gap-2">
        {model.blockedAdapters.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void model.copySetupCommand(blockedSetupCommand);
            }}
            type="button"
          >
            <CopySwapIcon copied={model.copiedCommand === blockedSetupCommand} />
            <CopySwapText copied={model.copiedCommand === blockedSetupCommand}>Copy setup commands</CopySwapText>
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={model.actionsBusy || model.adapters.every((adapter) => !adapter.installed)}
          onClick={() => {
            void model.syncInstalledSources();
          }}
          type="button"
        >
          {model.syncingAll ? "Syncing sources..." : "Sync installed sources"}
        </Button>
      </div>
    </>
  );
}

/**
 * Blocked adapters render as an iconiq setup-checklist -- but honesty first: `completedIds`
 * is permanently empty, so no item ever shows a fake-green checkmark. These adapters really
 * are unauthenticated right now; clicking a row copies its real setup command instead of
 * toggling a completion state that would misrepresent readiness.
 */
function SourceSetupChecklist({ model }: { model: SourceAdaptersModel }) {
  if (model.blockedAdapters.length === 0) {
    return null;
  }

  return (
    <section aria-label="Source setup checklist">
    <SetupChecklist completedIds={[]}>
      <SetupChecklistCard className="rounded-lg border-border bg-muted/20 p-3 sm:p-4">
        <SetupChecklistHeader>
          <div className="flex items-center justify-between gap-3">
            <SetupChecklistTitle className="text-sm">Source setup checklist</SetupChecklistTitle>
            <span className="text-xs text-muted-foreground">{model.blockedAdapters.length.toLocaleString()} blocked</span>
          </div>
          <SetupChecklistDescription>
            Not yet authenticated -- tap a source to copy its real setup command.
          </SetupChecklistDescription>
        </SetupChecklistHeader>
        <SetupChecklistList className="mt-3 gap-2">
          {model.blockedAdapters.map((adapter) => {
            const command = nextSetupCommand(adapter);
            const copied = command !== "" && model.copiedCommand === command;
            const missingExtra = adapter.setup.missing.filter((step) => step !== adapter.setup.nextAction);

            return (
              <SetupChecklistItem
                description={
                  <span className="flex flex-col gap-1">
                    <span>{adapter.setup.nextAction}</span>
                    {/* `missing` often repeats nextAction verbatim — only show what it adds. */}
                    {missingExtra.length > 0 ? <span>{missingExtra.join(" ")}</span> : null}
                    {command ? <CodeLine>{command}</CodeLine> : null}
                  </span>
                }
                icon={command ? copied ? <CopyCheck className="size-5" /> : <Copy className="size-5" /> : undefined}
                id={adapter.id}
                key={adapter.id}
                onClick={() => {
                  if (command) {
                    void model.copySetupCommand(command);
                  }
                }}
                title={adapter.displayName}
              />
            );
          })}
        </SetupChecklistList>
      </SetupChecklistCard>
    </SetupChecklist>
    </section>
  );
}

function CopySwapIcon({ copied }: { copied: boolean }) {
  const state = copied ? "copied" : "copy";

  return (
    <ActionSwapCascadeIcon className="size-3.5" value={state}>
      {copied ? <CopyCheck className="size-3.5" /> : <Copy className="size-3.5" />}
    </ActionSwapCascadeIcon>
  );
}

function CopySwapText({ copied, children }: { copied: boolean; children: string }) {
  return (
    <ActionSwapCascadeText splitText={copied ? "Copied" : children} value={copied ? "copied" : "copy"}>
      {copied ? "Copied" : children}
    </ActionSwapCascadeText>
  );
}

function ImportedSourceItems({ model }: { model: SourceAdaptersModel }) {
  return (
    <section className="flex flex-col gap-3" aria-label="Imported source items">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Imported evidence</h2>
          <p className="text-xs text-muted-foreground">
            Latest source records stored locally for matching, tagging, semantic search, and agent answers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Source</Label>
          <Select
            value={model.sourceItemFilter}
            onValueChange={(value) => {
              const nextFilter = value ?? "all";
              model.setSourceItemFilter(nextFilter);
              void model.refreshSourceItems(nextFilter);
            }}
          >
            <SelectTrigger size="sm" aria-label="Filter source items" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {model.adapters.map((adapter) => (
                <SelectItem key={adapter.id} value={adapter.id}>
                  {adapter.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      {model.sourceItemsLoading ? <p className="text-sm text-muted-foreground">Loading imported evidence...</p> : null}
      {!model.sourceItemsLoading && model.sourceItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No imported evidence yet. Sync a configured source or import JSON/JSONL/CSV/EML/MBOX/ICS/ZIP from a source
          CLI or export.
        </p>
      ) : null}
      {!model.sourceItemsLoading && model.sourceItems.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {model.sourceItems.map((item) => (
            <article
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
              key={item.id}
            >
              <div className="flex min-w-0 flex-col">
                <strong className="truncate text-sm font-medium">{item.title}</strong>
                <span className="text-xs text-muted-foreground">
                  {sourceLabel(model.adapters, item.sourceId)} · {item.kind}
                  {item.occurredAt ? ` · ${formatSourceDate(item.occurredAt)}` : ""}
                </span>
                <p className="truncate text-xs text-muted-foreground">{item.summary}</p>
              </div>
              <em className="shrink-0 text-sm font-medium tabular-nums not-italic">{formatSourceAmount(item)}</em>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SuggestedEvidenceMatches({ model }: { model: SourceAdaptersModel }) {
  return (
    <section className="flex flex-col gap-3" aria-label="Suggested evidence matches">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Suggested evidence matches</h2>
          <p className="text-xs text-muted-foreground">
            Review source records automatically matched to bank transactions before they become accepted context.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={model.evidenceLinksLoading}
          onClick={() => {
            void model.refreshEvidenceLinks();
          }}
          type="button"
        >
          {model.evidenceLinksLoading ? "Refreshing..." : "Refresh suggestions"}
        </Button>
      </header>
      {model.evidenceLinksLoading ? (
        <p className="text-sm text-muted-foreground">Loading evidence suggestions...</p>
      ) : null}
      {!model.evidenceLinksLoading && model.evidenceLinks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No suggested evidence matches yet.</p>
      ) : null}
      {!model.evidenceLinksLoading && model.evidenceLinks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {model.evidenceLinks.map((evidence) => (
            <EvidenceMatchRow evidence={evidence} key={`${evidence.transactionId}:${evidence.sourceItem.id}:${evidence.relationship}`} model={model} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function EvidenceMatchRow({ evidence, model }: { evidence: EvidenceReviewView; model: SourceAdaptersModel }) {
  return (
    <article className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-col">
        <strong className="truncate text-sm font-medium">{evidence.sourceItem.title}</strong>
        <span className="text-xs text-muted-foreground">
          {sourceLabel(model.adapters, evidence.sourceItem.sourceId)}
          {" -> "}
          {evidence.transaction.merchantName} · {Math.round(evidence.confidence * 100)}%
        </span>
        <p className="text-xs text-muted-foreground">
          {formatSourceAmount(evidence.sourceItem)} source record matched to{" "}
          {formatTransactionAmount(evidence.transaction)} bank transaction on{" "}
          {formatSourceDate(evidence.transaction.date)}.
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <a
          className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}
          href={`/transactions?search=${encodeURIComponent(evidence.transaction.merchantName)}`}
        >
          Open transaction
        </a>
        <Button
          variant="outline"
          size="xs"
          aria-label={`Accept suggested evidence ${evidence.sourceItem.title}`}
          onClick={() => {
            void model.updateEvidenceStatus(evidence, "accepted");
          }}
          type="button"
        >
          Accept
        </Button>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Dismiss suggested evidence ${evidence.sourceItem.title}`}
          onClick={() => {
            void model.updateEvidenceStatus(evidence, "dismissed");
          }}
          type="button"
        >
          Dismiss
        </Button>
      </div>
    </article>
  );
}

function SourceAdapterList({ model }: { model: SourceAdaptersModel }) {
  return (
    <div className="flex flex-col gap-3">
      {model.adapters.map((adapter) => (
        <SourceAdapterCard adapter={adapter} key={adapter.id} model={model} />
      ))}
    </div>
  );
}

function SourceAdapterCard({ adapter, model }: { adapter: SourceAdapterView; model: SourceAdaptersModel }) {
  const pastedImport = model.pastedImports[adapter.id] ?? "";

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-medium">{adapter.displayName}</h3>
          <span className="text-xs text-muted-foreground">{adapter.role}</span>
        </div>
        <ProviderStatusBadge
          status={model.syncingSourceId === adapter.id || model.importingSourceId === adapter.id ? "syncing" : adapter.status}
        />
      </div>

      <SourceAdapterDetails adapter={adapter} />
      {adapter.webAuth ? <MicrosoftWebAuthActions adapter={adapter} /> : null}
      <SourceAdapterFileActions adapter={adapter} model={model} />
      <SourceAdapterPasteActions adapter={adapter} model={model} pastedImport={pastedImport} />
    </article>
  );
}

function SourceAdapterDetails({ adapter }: { adapter: SourceAdapterView }) {
  return (
    <>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {adapter.webAuth ? (
          <span>
            {adapter.webAuth.connected
              ? `Microsoft account: ${adapter.webAuth.accountEmail ?? adapter.webAuth.accountName ?? "connected"}`
              : adapter.webAuth.configured
                ? "Microsoft web connection is ready to authorize."
                : "Microsoft web connection needs server credentials."}
          </span>
        ) : null}
        <span>
          {adapter.installed && !adapter.webAuth?.connected
            ? `CLI found: ${adapter.binary}`
            : adapter.webAuth?.connected
              ? `CLI fallback: ${adapter.binary}`
              : `CLI fallback install: ${adapter.installCommand}`}
        </span>
        {adapter.cache ? (
          <span>
            Local cache: {adapter.cache.summary}
            {adapter.cache.path ? ` (${adapter.cache.path})` : ""}
          </span>
        ) : null}
        <span>{formatSourceStorage(adapter.storage)}</span>
        <span>
          {adapter.webAuth?.connected
            ? "Sync source reads the latest Outlook mail and calendar events through Microsoft Graph."
            : `Sync command: ${adapter.syncCommand}`}
        </span>
        {adapter.lastSyncedAt ? <span>Last sync: {new Date(adapter.lastSyncedAt).toLocaleString()}</span> : null}
        {adapter.errorMessage ? <em className="text-destructive not-italic">{adapter.errorMessage}</em> : null}
        {adapter.refreshMessage ? <em className="text-muted-foreground not-italic">{adapter.refreshMessage}</em> : null}
      </div>
      {adapter.setupSteps.length > 0 && !adapter.webAuth?.configured ? (
        <div className="flex flex-col gap-1" aria-label={`${adapter.displayName} setup steps`}>
          {adapter.setupSteps.map((step) => (
            <CodeLine key={step}>{step}</CodeLine>
          ))}
        </div>
      ) : null}
    </>
  );
}

function MicrosoftWebAuthActions({ adapter }: { adapter: SourceAdapterView }) {
  const [disconnecting, setDisconnecting] = useState(false);
  const webAuth = adapter.webAuth;

  if (!webAuth) {
    return null;
  }

  if (!webAuth.connected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <a
          aria-disabled={!webAuth.configured}
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            !webAuth.configured && "pointer-events-none opacity-50"
          )}
          href={webAuth.configured ? webAuth.startPath : undefined}
        >
          Connect Microsoft
        </a>
        <span className="text-xs text-muted-foreground">Read-only mail and calendar access.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={disconnecting}
        onClick={() => {
          setDisconnecting(true);
          void fetch(webAuth.statusPath, { method: "DELETE" })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Unable to disconnect Microsoft.");
              }

              window.location.reload();
            })
            .catch(() => {
              setDisconnecting(false);
            });
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        {disconnecting ? "Disconnecting..." : "Disconnect Microsoft"}
      </Button>
      <span className="text-xs text-muted-foreground">Mail.Read · Calendars.Read</span>
    </div>
  );
}

function SourceAdapterFileActions({ adapter, model }: { adapter: SourceAdapterView; model: SourceAdaptersModel }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!adapter.installed || model.actionsBusy}
        onClick={() => model.syncSource(adapter.id)}
        type="button"
      >
        {model.syncingSourceId === adapter.id ? "Syncing..." : "Sync source"}
      </Button>
      <label
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-auto cursor-pointer flex-col items-start gap-0 py-1.5",
          model.actionsBusy && "pointer-events-none opacity-50"
        )}
      >
        <span>{model.importingSourceId === adapter.id ? "Importing..." : "Import JSON/JSONL/CSV/EML/MBOX/ICS/ZIP"}</span>
        <em className="text-[10px] font-normal not-italic text-muted-foreground">Up to {sourceImportLimitLabel}</em>
        <input
          accept={model.fileInputAccept}
          className="sr-only"
          disabled={model.actionsBusy}
          onChange={(event) => {
            void model.importSourceFile(adapter.id, event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </label>
      <label
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "h-auto cursor-pointer flex-col items-start gap-0 py-1.5",
          model.actionsBusy && "pointer-events-none opacity-50"
        )}
      >
        <span>{model.importingSourceId === adapter.id ? "Checking..." : "Validate import file"}</span>
        <em className="text-[10px] font-normal not-italic text-muted-foreground">No records saved</em>
        <input
          accept={model.fileInputAccept}
          className="sr-only"
          disabled={model.actionsBusy}
          onChange={(event) => {
            void model.validateSourceFile(adapter.id, event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </label>
    </div>
  );
}

function SourceAdapterPasteActions({
  adapter,
  model,
  pastedImport
}: {
  adapter: SourceAdapterView;
  model: SourceAdaptersModel;
  pastedImport: string;
}) {
  return (
    <details className="group/paste flex flex-col gap-2">
      <summary className="w-fit cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
        Paste JSON/JSONL/CSV/EML/MBOX/ICS
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <Textarea
          aria-label={`${adapter.displayName} JSON, JSONL, CSV, EML, MBOX, or ICS`}
          className="min-h-24 font-mono text-xs"
          disabled={model.actionsBusy}
          onChange={(event) => {
            model.setPastedImports((current) => ({
              ...current,
              [adapter.id]: event.target.value
            }));
          }}
          spellCheck={false}
          value={pastedImport}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={model.actionsBusy || !pastedImport.trim()}
            onClick={() => {
              void model.importPastedSource(adapter.id);
            }}
            type="button"
          >
            Import pasted records
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={model.actionsBusy || !pastedImport.trim()}
            onClick={() => {
              void model.validatePastedSource(adapter.id);
            }}
            type="button"
          >
            Validate pasted records
          </Button>
        </div>
      </div>
    </details>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

function CodeLine({ children }: { children: React.ReactNode }) {
  return (
    <code className="block w-fit max-w-full overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

function adapterFromApi(adapter: SourcesApiResponse["data"][number]): SourceAdapterView {
  return {
    authCommand: adapter.auth_command,
    binary: adapter.binary,
    cache: adapter.cache
      ? {
          path: adapter.cache.path,
          recordCount: adapter.cache.record_count,
          status: adapter.cache.status,
          summary: adapter.cache.summary
        }
      : undefined,
    displayName: adapter.display_name,
    errorMessage: adapter.error_message,
    evidenceKinds: adapter.evidence_kinds,
    id: adapter.id,
    installCommand: adapter.install_command,
    installed: adapter.installed,
    lastSyncedAt: adapter.last_synced_at,
    refreshMessage: adapter.refresh_message,
    role: adapter.role,
    setup: {
      commands: adapter.setup.commands,
      missing: adapter.setup.missing,
      nextAction: adapter.setup.next_action,
      ready: adapter.setup.ready
    },
    setupSteps: adapter.setup_steps,
    status: adapter.status,
    storage: {
      evidenceLinkCount: adapter.storage.evidence_link_count,
      lastImportedAt: adapter.storage.last_imported_at,
      latestOccurredAt: adapter.storage.latest_occurred_at,
      sourceItemCount: adapter.storage.source_item_count
    },
    syncCommand: adapter.sync_command,
    webAuth: adapter.web_auth
      ? {
          accountEmail: adapter.web_auth.account_email,
          accountName: adapter.web_auth.account_name,
          configured: adapter.web_auth.configured,
          connected: adapter.web_auth.connected,
          startPath: adapter.web_auth.start_path,
          statusPath: adapter.web_auth.status_path
        }
      : undefined
  };
}

function nextSetupCommand(adapter: SourceAdapterView): string {
  return (
    adapter.setup.commands.find((command) => {
      if (!adapter.installed) {
        return command.kind === "install";
      }

      if (adapter.status !== "connected") {
        return command.kind === "auth";
      }

      return command.kind === "backfill" || command.kind === "sync";
    })?.command ??
    adapter.setup.commands[0]?.command ??
    ""
  );
}

function sourceItemFromApi(item: SourceItemsApiResponse["data"][number]): SourceItemView {
  return {
    amount: sourceAmountForUi(item.amount),
    currency: normalizeCurrencyCode(item.currency),
    externalId: item.external_id,
    id: item.id,
    kind: item.kind,
    merchantName: item.merchant_name,
    occurredAt: item.occurred_at,
    sourceId: item.source_id,
    summary: compactSourcePreviewSummary(item.summary),
    title: compactSourcePreviewTitle(item.title)
  };
}

function evidenceFromApi(item: EvidenceApiResponse["data"][number]): EvidenceReviewView {
  return {
    confidence: item.confidence,
    createdAt: item.created_at,
    relationship: item.relationship,
    sourceItem: {
      amount: sourceAmountForUi(item.source_item.amount),
      currency: normalizeCurrencyCode(item.source_item.currency),
      externalId: item.source_item.external_id,
      id: item.source_item.id,
      kind: item.source_item.kind,
      merchantName: item.source_item.merchant_name,
      occurredAt: item.source_item.occurred_at,
      sourceId: item.source_item.source_id,
      summary: compactSourcePreviewSummary(item.source_item.summary),
      title: compactSourcePreviewTitle(item.source_item.title)
    },
    status: item.status,
    transaction: {
      amount: item.transaction.amount,
      currency: item.transaction.currency,
      date: item.transaction.date,
      description: item.transaction.description,
      id: item.transaction.id,
      merchantName: item.transaction.merchant_name
    },
    transactionId: item.transaction_id
  };
}

function sourceLabel(adapters: SourceAdapterView[], sourceId: string): string {
  return adapters.find((adapter) => adapter.id === sourceId)?.displayName ?? sourceId;
}

function formatSourceDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatSourceAmount(item: SourceItemView): string {
  if (item.amount === undefined) {
    return item.merchantName ?? "";
  }

  const currency = normalizeCurrencyCode(item.currency);

  if (!currency) {
    return sourceDecimalFormatter.format(item.amount);
  }

  return sourceCurrencyFormatter(currency).format(item.amount);
}

function sourceAmountForUi(amount: number | null | undefined): number | undefined {
  return typeof amount === "number" && Number.isFinite(amount) ? amount : undefined;
}

function sourceCurrencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = sourceCurrencyFormatters.get(currency);

  if (!formatter) {
    formatter = Intl.NumberFormat(undefined, {
      currency,
      style: "currency"
    });
    sourceCurrencyFormatters.set(currency, formatter);
  }

  return formatter;
}

function formatTransactionAmount(transaction: EvidenceReviewView["transaction"]): string {
  return formatCurrency(transaction.amount, transaction.currency);
}

function formatSourceStorage(storage: SourceAdapterView["storage"]): string {
  const detail = storage.lastImportedAt ? ` Latest import: ${formatSourceDate(storage.lastImportedAt)}.` : "";

  return `Stored evidence: ${storage.sourceItemCount.toLocaleString()} records, ${storage.evidenceLinkCount.toLocaleString()} links.${detail}`;
}
