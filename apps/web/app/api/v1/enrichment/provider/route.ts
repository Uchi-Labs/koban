import { NextResponse } from "next/server";
import { getEffectiveLlmEnrichmentStatus, recordLlmProviderHealth } from "@/lib/enrichment-runs";
import { checkConfiguredLlmProvider } from "@/lib/llm-enrichment";

export const runtime = "nodejs";

export async function GET() {
  const provider = await getEffectiveLlmEnrichmentStatus();

  return NextResponse.json({
    object: "enrichment_provider",
    base_url: provider.baseUrl,
    chatgpt_oauth_connected: provider.chatGptOAuthConnected,
    chatgpt_oauth_enabled: provider.chatGptOAuthEnabled,
    configured: provider.configured,
    credential_source: provider.credentialSource,
    error_message: provider.errorMessage,
    model: provider.model,
    provider: provider.provider,
    status: provider.status,
    timeout_ms: provider.timeoutMs
  });
}

export async function POST() {
  const health = await checkConfiguredLlmProvider();
  const provider = health.provider;
  await recordLlmProviderHealth(provider, health.checkedAt);

  return NextResponse.json({
    object: "enrichment_provider_check",
    base_url: provider.baseUrl,
    checked_at: health.checkedAt,
    chatgpt_oauth_connected: provider.chatGptOAuthConnected,
    chatgpt_oauth_enabled: provider.chatGptOAuthEnabled,
    completed: health.completed,
    configured: provider.configured,
    credential_source: provider.credentialSource,
    error_message: health.errorMessage ?? provider.errorMessage,
    model: provider.model,
    provider: provider.provider,
    status: provider.status,
    timeout_ms: provider.timeoutMs
  });
}
