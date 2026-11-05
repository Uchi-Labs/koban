import { NextRequest, NextResponse } from "next/server";
import { unknownCursorResponse } from "@/lib/api-error";
import { paginateById, parseListParams, serializeAccount } from "@/lib/finance-api";
import { getFinanceData } from "@/lib/finance-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { accounts } = await getFinanceData();
  const type = request.nextUrl.searchParams.get("type");
  const institution = request.nextUrl.searchParams.get("institution");
  const { limit, startingAfter } = parseListParams(request.nextUrl.searchParams);
  const rows = accounts
    .filter((account) => (type ? account.type === type : true))
    .filter((account) => (institution ? account.institutionName.toLowerCase().includes(institution.toLowerCase()) : true))
    .sort((left, right) => left.institutionName.localeCompare(right.institutionName) || left.name.localeCompare(right.name));
  try {
    return NextResponse.json(paginateById(rows.map(serializeAccount), { limit, startingAfter }));
  } catch (error) {
    return unknownCursorResponse(error) ?? Promise.reject(error);
  }
}
