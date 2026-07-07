import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { deleteTellerConnection } from "@/lib/teller-server";

export const runtime = "nodejs";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ enrollmentId: string }> }) {
  try {
    const { enrollmentId } = await params;
    const decoded = decodeURIComponent(enrollmentId).trim();

    if (!decoded) {
      return NextResponse.json({ error: "A connection id is required." }, { status: 400 });
    }

    const result = await deleteTellerConnection(decoded);

    if (!result.removed) {
      return NextResponse.json({ error: "No matching connection was found." }, { status: 404 });
    }

    return NextResponse.json({
      object: "teller_connection_removal",
      account_count: result.accountCount,
      removed: result.removed,
      transaction_count: result.transactionCount,
      status: result.status
    });
  } catch (error) {
    return errorResponse(error, "Unable to remove the connection.");
  }
}
