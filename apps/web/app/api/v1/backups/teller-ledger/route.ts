import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  exportTellerLedgerBackup,
  importTellerLedgerBackup,
  importTellerLedgerBackupFile,
  type TellerLedger
} from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET() {
  const ledger = await exportTellerLedgerBackup();

  if (!ledger) {
    return NextResponse.json({ error: "No Teller ledger is available in the local database." }, { status: 404 });
  }

  return new NextResponse(`${JSON.stringify(ledger, null, 2)}\n`, {
    headers: {
      "Content-Disposition": `attachment; filename="ai-finances-teller-ledger-${ledger.lastSyncedAt.slice(0, 10)}.json"`,
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
    let ledger: TellerLedger | null = null;

    if (body.use_local_backup === true) {
      ledger = await importTellerLedgerBackupFile();
    } else {
      const candidate =
        typeof body.content === "string"
          ? JSON.parse(body.content) as unknown
          : body.ledger;

      ledger = await importTellerLedgerBackup(candidate as TellerLedger);
    }

    if (!ledger) {
      return NextResponse.json({ error: "Import content is not a valid Teller ledger backup." }, { status: 400 });
    }

    return NextResponse.json({
      object: "teller_ledger_backup_import",
      account_count: ledger.accounts.length,
      transaction_count: ledger.transactions.length,
      last_synced_at: ledger.lastSyncedAt
    });
  } catch {
    return NextResponse.json({ error: "Import content is not valid JSON." }, { status: 400 });
  }
}
