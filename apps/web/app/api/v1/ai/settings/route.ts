import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/api-request";
import {
  isLlmChoice,
  readStoredLlmSettings,
  toPublicLlmSettings,
  writeStoredLlmSettings,
  type StoredLlmSettings
} from "@/lib/ai/llm-settings";
import { getLlmEnrichmentStatusWithStorage } from "@/lib/llm-enrichment";
import { maskLlmStatusForPublicDemo } from "@/lib/public-demo";
import { readWorkspaceEnv } from "@/lib/workspace-env";

export const runtime = "nodejs";

async function settingsResponse() {
  // The model Ask answers with (its reasoning model), not enrichment's simple one.
  const [settings, provider] = await Promise.all([
    readStoredLlmSettings(),
    getLlmEnrichmentStatusWithStorage(readWorkspaceEnv(), "reasoning").then(maskLlmStatusForPublicDemo)
  ]);

  return NextResponse.json({
    object: "ai_settings",
    ...toPublicLlmSettings(settings),
    provider: {
      base_url: provider.baseUrl,
      claude_credential: provider.claudeCredential,
      configured: provider.configured,
      credential_source: provider.credentialSource,
      error_message: provider.errorMessage,
      model: provider.model,
      provider: provider.provider,
      status: provider.status
    }
  });
}

export async function GET() {
  return settingsResponse();
}

/**
 * Body: `{ choice, base_url?, model?, api_key? }`. `api_key` is a string to set,
 * `null` to clear, or absent to keep the saved key when the server URL is unchanged.
 */
export async function PUT(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { body } = parsed;

  if (!isLlmChoice(body.choice)) {
    return NextResponse.json(
      { error: "choice must be one of claude, chatgpt, ollama, openai_compatible." },
      { status: 400 }
    );
  }

  for (const key of ["base_url", "model", "api_key"] as const) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== "string") {
      return NextResponse.json({ error: `${key} must be a string.` }, { status: 400 });
    }
  }

  const baseUrl = typeof body.base_url === "string" && body.base_url.trim() ? body.base_url.trim() : undefined;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  if (baseUrl) {
    try {
      const url = new URL(baseUrl);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("protocol");
      }
    } catch {
      return NextResponse.json({ error: "base_url must be an http(s) URL." }, { status: 400 });
    }
  }

  if (body.choice === "openai_compatible" && !baseUrl) {
    return NextResponse.json({ error: "base_url is required for an OpenAI-compatible server." }, { status: 400 });
  }

  if ((body.choice === "ollama" || body.choice === "openai_compatible") && !model) {
    return NextResponse.json({ error: "model is required for a local model." }, { status: 400 });
  }

  const previous = await readStoredLlmSettings();
  let apiKey: string | undefined;

  if (body.choice === "openai_compatible") {
    if (typeof body.api_key === "string") {
      apiKey = body.api_key.trim() || undefined;
    } else if (body.api_key === undefined && previous?.choice === "openai_compatible" && previous.baseUrl === baseUrl) {
      apiKey = previous.apiKey;
    }
  }

  const next: StoredLlmSettings = {
    choice: body.choice,
    ...(baseUrl && (body.choice === "ollama" || body.choice === "openai_compatible") ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {})
  };
  await writeStoredLlmSettings(next);
  return settingsResponse();
}

/** Forget the Settings choice and go back to the AI_FINANCES_LLM_* environment. */
export async function DELETE() {
  await writeStoredLlmSettings(null);
  return settingsResponse();
}
