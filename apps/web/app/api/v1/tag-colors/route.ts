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

  if (typeof parsed.body.name !== "string") {
    return NextResponse.json({ error: "Tag name must be a string." }, { status: 400 });
  }

  const hasColor = Object.prototype.hasOwnProperty.call(parsed.body, "color");

  if (hasColor && parsed.body.color !== null && typeof parsed.body.color !== "string") {
    return NextResponse.json({ error: "Tag color must be a string or null." }, { status: 400 });
  }

  const color = parsed.body.color === null ? null : typeof parsed.body.color === "string" ? parsed.body.color : undefined;

  try {
    const style = await upsertTagStyle(parsed.body.name, color);
    return NextResponse.json(tagStyleToApi(style));
  } catch (error) {
    return errorResponse(error, "Unable to save tag style.", 400);
  }
}

function tagStyleToApi(style: Awaited<ReturnType<typeof listTagStyles>>[number]) {
  return {
    object: "tag_color",
    name: style.name,
    color: style.color ?? null,
    kind: style.kind,
    created_at: style.createdAt,
    updated_at: style.updatedAt
  };
}
