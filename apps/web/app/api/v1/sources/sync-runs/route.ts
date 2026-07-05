import { NextResponse } from "next/server";
import { readOptionalJsonObject } from "@/lib/api-request";
import { syncSourceAdapters } from "@/lib/source-adapters";
import { parseOptionalSourceIds } from "@/lib/sync-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const sourceIds = parseOptionalSourceIds(parsed.body.source_ids);

  if (!sourceIds.ok) {
    return NextResponse.json({ error: sourceIds.error }, { status: 400 });
  }

  return NextResponse.json(await syncSourceAdapters(sourceIds.value));
}
