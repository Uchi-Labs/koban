import { NextResponse } from "next/server";
import { dismissInsight } from "@/lib/insight-dismissals";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ insightId: string }> }) {
  const { insightId } = await params;
  await dismissInsight(decodeURIComponent(insightId));
  return NextResponse.json({ dismissed: true, id: decodeURIComponent(insightId), object: "insight" });
}
