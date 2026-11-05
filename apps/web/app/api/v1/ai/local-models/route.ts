import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import { listLocalModels } from "@/lib/ai/local-models";
import { ollamaDefaultBaseUrl, readStoredLlmSettings } from "@/lib/ai/llm-settings";

export const runtime = "nodejs";

/**
 * Lists the models a local server offers. POST so a server key stays out of
 * URLs and logs. Body: `{ kind: "ollama" | "openai_compatible", base_url?, api_key? }`.
 */
export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { body } = parsed;

  if (body.kind !== "ollama" && body.kind !== "openai_compatible") {
    return NextResponse.json({ error: "kind must be ollama or openai_compatible." }, { status: 400 });
  }

  if (body.base_url !== undefined && typeof body.base_url !== "string") {
    return NextResponse.json({ error: "base_url must be a string." }, { status: 400 });
  }

  if (body.api_key !== undefined && typeof body.api_key !== "string") {
    return NextResponse.json({ error: "api_key must be a string." }, { status: 400 });
  }

  const baseUrl = (typeof body.base_url === "string" && body.base_url.trim()) || (body.kind === "ollama" ? ollamaDefaultBaseUrl : "");

  try {
    const url = new URL(baseUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("protocol");
    }
  } catch {
    return NextResponse.json({ error: "base_url must be an http(s) URL." }, { status: 400 });
  }

  const stored = await readStoredLlmSettings();
  const apiKey =
    (typeof body.api_key === "string" && body.api_key.trim()) ||
    (stored?.choice === "openai_compatible" && stored.baseUrl === baseUrl ? stored.apiKey : undefined);

  try {
    const listing = await listLocalModels(body.kind, baseUrl, { apiKey: apiKey || undefined });
    return NextResponse.json({ object: "list", data: listing.models.map((id) => ({ object: "model", id })), url: listing.source });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreachable";
    return NextResponse.json(
      {
        error:
          body.kind === "ollama"
            ? `Could not reach Ollama at ${baseUrl} (${detail}). Is Ollama running?`
            : `Could not list models at ${baseUrl} (${detail}). Is the server running?`
      },
      { status: 502 }
    );
  }
}
