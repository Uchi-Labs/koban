import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { LineItemCategoryError, setSourceItemLineCategory } from "@/lib/db/finance-db";
import { lineSplitToApi, linesToApi } from "@/lib/line-items-api";

export const runtime = "nodejs";

/**
 * Files one receipt line under a category, splitting a mixed charge such as a
 * warehouse run across Groceries, Household and Pets. Body: `{ category_id }`,
 * or `{ category_id: null }` to clear. The split is a user overlay: it survives
 * a re-import of the receipt.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ position: string; sourceItemId: string }> }
) {
  const { position: rawPosition, sourceItemId } = await params;
  const position = Number(rawPosition);

  if (!Number.isInteger(position) || position < 0) {
    return NextResponse.json({ error: "position must be a line index (0 or more)." }, { status: 400 });
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const categoryId = parsed.body.category_id;

  if (categoryId !== null && (typeof categoryId !== "string" || !categoryId.trim())) {
    return NextResponse.json({ error: "category_id must be a category id or null." }, { status: 400 });
  }

  try {
    const lines = await setSourceItemLineCategory(decodeURIComponent(sourceItemId), position, categoryId === null ? null : categoryId.trim());
    return NextResponse.json({ object: "list", data: linesToApi(lines), split: lineSplitToApi(lines) });
  } catch (error) {
    if (error instanceof LineItemCategoryError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    throw error;
  }
}
