import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-request";
import { listTagStyles, upsertTagStyle } from "@/lib/db/finance-db";

export const runtime = "nodejs";

export async function GET() {
  const styles = await listTagStyles();

  return NextResponse.json({
    object: "list",
    data: styles.map(tagStyleToApi),
    has_more: false
  });
}

export async function POST(request: NextRequest) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const name = typeof parsed.body.name === "string" ? parsed.body.name : "";
  const color =
    parsed.body.color === null ? null : typeof parsed.body.color === "string" ? parsed.body.color : undefined;

  try {
    const style = await upsertTagStyle(name, color);
    return NextResponse.json(tagStyleToApi(style));
  } catch (error) {
    return errorResponse(error, "Unable to save tag color.", 400);
  }
}

function tagStyleToApi(style: Awaited<ReturnType<typeof listTagStyles>>[number]) {
  return {
    object: "tag_color",
    name: style.name,
    color: style.color,
    kind: style.kind,
    created_at: style.createdAt,
    updated_at: style.updatedAt
  };
}
