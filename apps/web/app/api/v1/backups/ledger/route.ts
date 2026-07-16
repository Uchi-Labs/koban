import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  exportLedgerBackup,
  importLedgerBackup,
  importLedgerBackupFile,
  type Ledger
} from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET() {
  const ledger = await exportLedgerBackup();

  if (!ledger) {
    return NextResponse.json({ error: "No ledger is available in the local database." }, { status: 404 });
  }

  return new NextResponse(`${JSON.stringify(ledger, null, 2)}\n`, {
    headers: {
      "Content-Disposition": `attachment; filename="ai-finances-ledger-${ledger.lastSyncedAt.slice(0, 10)}.json"`,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export async function POST(request: Request) {
  try {
    const parsed = await readJsonObject(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body as { content?: unknown; ledger?: unknown; use_local_backup?: unknown };
    const ledger = body.use_local_backup === true
      ? await importLedgerBackupFile()
      : await importLedgerBackup(
          (typeof body.content === "string" ? JSON.parse(body.content) as unknown : body.ledger) as Ledger
        );

    if (!ledger) {
      return NextResponse.json({ error: "Import content is not a valid ledger backup." }, { status: 400 });
    }

    return NextResponse.json({
      object: "ledger_backup_import",
      account_count: ledger.accounts.length,
      transaction_count: ledger.transactions.length,
      last_synced_at: ledger.lastSyncedAt
    });
  } catch {
    return NextResponse.json({ error: "Import content is not valid JSON." }, { status: 400 });
  }
}
