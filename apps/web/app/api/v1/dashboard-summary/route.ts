import { NextResponse } from "next/server";
import { serializeDashboardSummary } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET() {
  const { dashboardSummary, source } = await getFinanceData();

  return NextResponse.json({
    ...serializeDashboardSummary(dashboardSummary),
    source
  });
}
