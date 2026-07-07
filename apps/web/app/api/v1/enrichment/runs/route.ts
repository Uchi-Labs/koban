import { NextResponse } from "next/server";
import { readOptionalJsonObject } from "@/lib/api-request";
import { generateEnrichmentSuggestions } from "@/lib/enrichment-runs";
import { parseBoundedLimit } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await getFinanceData();
  const parsed = await readOptionalJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.body as { limit?: unknown };
  const limit = parseBoundedLimit(body.limit, 100);

  return NextResponse.json({
    object: "enrichment_run",
    ...(await generateEnrichmentSuggestions(limit))
  });
}
