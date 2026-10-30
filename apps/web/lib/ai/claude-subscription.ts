import type { LanguageModel } from "ai";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import type { WorkspaceEnv } from "@/lib/workspace-env";

export const claudeSubscriptionFallbackValue = "claude_subscription";
// The CLI talks to Anthropic's API; recorded like the ChatGPT Codex endpoint so
// provider readiness checks treat the subscription as a configured provider.
export const claudeSubscriptionBaseUrl = "https://api.anthropic.com";
// A CLI process start precedes every subscription call, so it cannot share an
// HTTP provider's timeout.
export const claudeSubscriptionMinTimeoutMs = 90_000;

const defaultSimpleModel = "haiku";
const defaultReasoningModel = "sonnet";

export function isClaudeSubscriptionFallbackEnabled(env: WorkspaceEnv): boolean {
  return env.AI_FINANCES_LLM_FALLBACK?.trim() === claudeSubscriptionFallbackValue;
}

export function selectClaudeSubscriptionModel(env: WorkspaceEnv, useCase: "default" | "reasoning" | "simple"): string {
  if (useCase === "simple") {
    return env.AI_FINANCES_CLAUDE_SIMPLE_MODEL?.trim() || defaultSimpleModel;
  }

  return env.AI_FINANCES_CLAUDE_REASONING_MODEL?.trim() || defaultReasoningModel;
}

// Drives the official, already logged-in Claude Code CLI as a plain model
// client: no tools, no filesystem settings, MCP or slash commands, no extended
// thinking, no saved session. Authentication stays with the CLI; this
// module never reads its credential files.
export function createClaudeSubscriptionLanguageModel(model: string, env: WorkspaceEnv): LanguageModel {
  const provider = createClaudeCode({
    defaultSettings: {
      env: {
        // Any of these would route the CLI to API billing or another backend
        // instead of the Claude subscription.
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: undefined,
        ANTHROPIC_BASE_URL: undefined,
        CLAUDE_CODE_USE_BEDROCK: undefined,
        CLAUDE_CODE_USE_VERTEX: undefined,
        CLAUDE_CODE_USE_FOUNDRY: undefined,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTO_COMPACT: "1"
      },
      // Structured output is delivered through the CLI's internal output tool,
      // and larger batches take a validation turn after it. With no tools
      // enabled, extra turns cannot do anything else.
      maxTurns: 3,
      mcpServers: {},
      // Without a path the Agent SDK runs its bundled CLI, which lags the
      // installed one and rejects newer models (2.1.278 refused Opus 5.5).
      pathToClaudeCodeExecutable: env.AI_FINANCES_CLAUDE_CLI_PATH?.trim() || "claude",
      permissionMode: "dontAsk",
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      // Adaptive thinking spent ~6.7K tokens (~85s) on a 10-transaction
      // categorization batch, past the sync's one-minute enrichment budget.
      thinking: { type: "disabled" },
      tools: []
    }
  });

  // The provider ships a newer @ai-sdk/provider patch than `ai` pins; both are
  // the same v4 model spec and differ only in JSON metadata typings.
  return provider(model) as unknown as LanguageModel;
}
