import { NextResponse } from "next/server";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

export function GET() {
  const env = readWorkspaceEnv();

  return NextResponse.json({
    ok: true,
    db: env.DATABASE_URL ? "postgres" : "pglite"
  });
}
