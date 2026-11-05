import type { WorkspaceEnv } from "@/lib/workspace-env";

/**
 * The model Ask and enrichment use, chosen in Settings and stored in sync_state.
 * When nothing is stored, the AI_FINANCES_LLM_* environment decides, as before.
 * A stored choice is applied as an overlay on the environment, so every reader
 * of that environment (readiness, the model factory) sees the same provider.
 */
export type LlmChoice = "claude" | "chatgpt" | "ollama" | "openai_compatible";

export interface StoredLlmSettings {
  /** Only for `openai_compatible`; never sent back to the browser. */
  apiKey?: string;
  baseUrl?: string;
  choice: LlmChoice;
  model?: string;
}

export interface PublicLlmSettings {
  base_url?: string;
  choice: LlmChoice | "env";
  has_api_key: boolean;
  model?: string;
}

export const llmSettingsStateKey = "llm_provider_settings_v1";
export const llmChoiceEnvKey = "AI_FINANCES_LLM_CHOICE";
export const ollamaDefaultBaseUrl = "http://127.0.0.1:11434/v1";

const llmChoices = new Set<LlmChoice>(["claude", "chatgpt", "ollama", "openai_compatible"]);

export function isLlmChoice(value: unknown): value is LlmChoice {
  return typeof value === "string" && llmChoices.has(value as LlmChoice);
}

export function parseStoredLlmSettings(raw: string | undefined): StoredLlmSettings | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredLlmSettings>;

    if (!isLlmChoice(parsed.choice)) {
      return null;
    }

    return {
      apiKey: typeof parsed.apiKey === "string" && parsed.apiKey.trim() ? parsed.apiKey.trim() : undefined,
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : undefined,
      choice: parsed.choice,
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : undefined
    };
  } catch {
    return null;
  }
}

export function toPublicLlmSettings(settings: StoredLlmSettings | null): PublicLlmSettings {
  if (!settings) {
    return { choice: "env", has_api_key: false };
  }

  return {
    base_url: settings.baseUrl,
    choice: settings.choice,
    has_api_key: Boolean(settings.apiKey),
    model: settings.model
  };
}

/**
 * The environment with a stored choice laid over it. Local choices drop every
 * cloud credential and the Claude fallback, so a provider failure never sends
 * the prompt to a cloud model the user did not pick.
 */
export function applyLlmSettingsToEnv(env: WorkspaceEnv, settings: StoredLlmSettings | null): WorkspaceEnv {
  if (!settings) {
    return env;
  }

  const next: WorkspaceEnv = { ...env, [llmChoiceEnvKey]: settings.choice };

  if (settings.choice === "claude") {
    next.AI_FINANCES_LLM_PROVIDER = "claude_subscription";

    if (settings.model) {
      next.AI_FINANCES_CLAUDE_REASONING_MODEL = settings.model;
      next.AI_FINANCES_CLAUDE_SIMPLE_MODEL = settings.model;
    }

    return next;
  }

  delete next.OPENAI_API_KEY;
  delete next.AI_FINANCES_LLM_API_KEY;

  if (settings.choice === "chatgpt") {
    next.AI_FINANCES_LLM_PROVIDER = "openai_compatible";
    next.AI_FINANCES_PREFER_CHATGPT_OAUTH = "1";
    delete next.AI_FINANCES_LLM_BASE_URL;
    setSingleModel(next, settings.model);
    return next;
  }

  delete next.AI_FINANCES_ENABLE_CHATGPT_OAUTH;
  delete next.AI_FINANCES_PREFER_CHATGPT_OAUTH;
  delete next.AI_FINANCES_LLM_FALLBACK;
  setSingleModel(next, settings.model);

  if (settings.choice === "ollama") {
    next.AI_FINANCES_LLM_PROVIDER = "ollama";
    next.AI_FINANCES_LLM_BASE_URL = settings.baseUrl ?? ollamaDefaultBaseUrl;
    return next;
  }

  next.AI_FINANCES_LLM_PROVIDER = "openai_compatible";

  if (settings.baseUrl) {
    next.AI_FINANCES_LLM_BASE_URL = settings.baseUrl;
  } else {
    delete next.AI_FINANCES_LLM_BASE_URL;
  }

  if (settings.apiKey) {
    next.AI_FINANCES_LLM_API_KEY = settings.apiKey;
  }

  return next;
}

function setSingleModel(env: WorkspaceEnv, model: string | undefined) {
  if (!model) {
    return;
  }

  env.AI_FINANCES_LLM_MODEL = model;
  delete env.AI_FINANCES_LLM_REASONING_MODEL;
  delete env.AI_FINANCES_LLM_SIMPLE_MODEL;
}

export async function readStoredLlmSettings(): Promise<StoredLlmSettings | null> {
  const { readSyncStateValue } = await import("@/lib/db/finance-db");
  return parseStoredLlmSettings(await readSyncStateValue(llmSettingsStateKey));
}

export async function writeStoredLlmSettings(settings: StoredLlmSettings | null): Promise<void> {
  const { deleteSyncStateValue, writeSyncStateValue } = await import("@/lib/db/finance-db");

  if (!settings) {
    await deleteSyncStateValue(llmSettingsStateKey);
    return;
  }

  await writeSyncStateValue(llmSettingsStateKey, JSON.stringify(settings));
}

/** The environment every LLM reader should use: the stored Settings choice over the workspace env. */
export async function resolveLlmEnv(env: WorkspaceEnv): Promise<WorkspaceEnv> {
  if (env[llmChoiceEnvKey]) {
    return env;
  }

  return applyLlmSettingsToEnv(env, await readStoredLlmSettings());
}

/** True for loopback, private-network and Tailscale hosts: a model on the user's own machines. */
export function isPrivateNetworkUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const host = new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".ts.net") || host === "::1") {
      return true;
    }

    const octets = host.split(".").map(Number);

    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
      return false;
    }

    const [a, b] = octets;
    return (
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      // Tailscale's CGNAT range.
      (a === 100 && b >= 64 && b <= 127)
    );
  } catch {
    return false;
  }
}
