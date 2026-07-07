import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { syncSourceAdapter } from "@/lib/source-adapters";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;

  try {
    return NextResponse.json(await syncSourceAdapter(decodeURIComponent(sourceId)));
  } catch (error) {
    return errorResponse(error, "Unable to sync source adapter.", 400);
  }
}
