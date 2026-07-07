import {
  applyPersistedLlmProviderHealth,
  generateEnrichmentSuggestionsWithLlm,
  recordLlmProviderHealth,
  type EnrichmentRunResult
} from "@/lib/db/finance-db";
import {
  generateLlmEnrichmentSuggestions,
  getLlmEnrichmentStatusWithStorage,
  type LlmProviderStatus
} from "@/lib/llm-enrichment";
import { readWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";

export async function getEffectiveLlmEnrichmentStatus(
  env: WorkspaceEnv = readWorkspaceEnv()
): Promise<LlmProviderStatus> {
  const configuredProvider = await getLlmEnrichmentStatusWithStorage(env);
  return applyPersistedLlmProviderHealth(configuredProvider) as Promise<LlmProviderStatus>;
}

export async function generateEnrichmentSuggestions(limit = 100): Promise<EnrichmentRunResult> {
  return generateEnrichmentSuggestionsWithLlm(limit, {
    generateLlmEnrichmentSuggestions,
    getProviderStatus: getLlmEnrichmentStatusWithStorage
  });
}

export { recordLlmProviderHealth };
export type { EnrichmentRunResult };
