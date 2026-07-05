import { NextResponse } from "next/server";
import { syncSourceAdapter } from "@/lib/source-adapters";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;

  try {
    return NextResponse.json(await syncSourceAdapter(decodeURIComponent(sourceId)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync source adapter." },
      { status: 400 }
    );
  }
}
