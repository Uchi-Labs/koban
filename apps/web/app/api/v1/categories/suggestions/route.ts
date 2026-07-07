import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { suggestCategories } from "@/lib/category-suggestions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const description = typeof parsed.body.description === "string" ? parsed.body.description : undefined;
  const merchants = Array.isArray(parsed.body.merchants)
    ? parsed.body.merchants.flatMap((merchant) => (typeof merchant === "string" ? [merchant] : []))
    : undefined;
  const result = await suggestCategories({ description, merchants });

  return NextResponse.json({
    object: "category_suggestions",
    completed: result.completed,
    error_message: result.errorMessage,
    provider_configured: result.providerConfigured,
    suggestions: result.suggestions
  });
}
