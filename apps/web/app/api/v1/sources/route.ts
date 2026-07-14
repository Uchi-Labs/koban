import { NextResponse } from "next/server";
import { getSourceAdapterDiagnostics } from "@/lib/source-adapters";

export const runtime = "nodejs";

export async function GET() {
  const diagnostics = await getSourceAdapterDiagnostics();

  return NextResponse.json({
    object: "list",
    data: diagnostics.adapters.map((adapter) => ({
      object: "source_adapter",
      id: adapter.id,
      kind: adapter.kind,
      display_name: adapter.displayName,
      role: adapter.role,
      binary: adapter.binary,
      cache: adapter.cache
        ? {
            path: adapter.cache.path,
            record_count: adapter.cache.recordCount,
            status: adapter.cache.status,
            summary: adapter.cache.summary
          }
        : undefined,
      installed: adapter.installed,
      status: adapter.status,
      setup: {
        commands: adapter.setup.commands.map((command) => ({
          command: command.command,
          kind: command.kind,
          label: command.label
        })),
        missing: adapter.setup.missing,
        next_action: adapter.setup.nextAction,
        ready: adapter.setup.ready
      },
      storage: {
        evidence_link_count: adapter.storage.evidenceLinkCount,
        last_imported_at: adapter.storage.lastImportedAt,
        latest_occurred_at: adapter.storage.latestOccurredAt,
        source_item_count: adapter.storage.sourceItemCount
      },
      web_auth: adapter.webAuth
        ? {
            account_email: adapter.webAuth.accountEmail,
            account_name: adapter.webAuth.accountName,
            configured: adapter.webAuth.configured,
            connected: adapter.webAuth.connected,
            start_path: adapter.webAuth.startPath,
            status_path: adapter.webAuth.statusPath
          }
        : undefined,
      last_synced_at: adapter.lastSyncedAt,
      error_message: adapter.errorMessage,
      refresh_message: adapter.refreshMessage,
      install_command: adapter.installCommand,
      auth_command: adapter.authCommand,
      setup_steps: adapter.setupSteps,
      sync_command: adapter.syncCommand,
      evidence_kinds: adapter.evidenceKinds
    })),
    summary: diagnostics.summary,
    has_more: false
  });
}
