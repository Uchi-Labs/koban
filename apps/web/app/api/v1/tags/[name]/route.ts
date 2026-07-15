import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { renameTag } from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }
  if (typeof parsed.body.new_name !== "string") {
    return NextResponse.json({ error: "new_name must be a string." }, { status: 400 });
  }

  const { name } = await params;

  try {
    const style = await renameTag(decodeURIComponent(name), parsed.body.new_name);
    return NextResponse.json({
      object: "tag",
      name: style.name,
      color: style.color ?? null,
      kind: style.kind,
      created_at: style.createdAt,
      updated_at: style.updatedAt
    });
  } catch (error) {
    return errorResponse(error, "Unable to rename tag.", 400);
  }
}
