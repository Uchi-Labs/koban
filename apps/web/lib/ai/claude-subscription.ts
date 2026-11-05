import { execFile } from "node:child_process";
import { createAnthropic } from "@ai-sdk/anthropic";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { ClaudeCredentialError, resolveClaudeAccessToken } from "@/lib/ai/claude-oauth";
import type { WorkspaceEnv } from "@/lib/workspace-env";

type FetchLike = typeof fetch;
type CallOptions = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"];

export const claudeSubscriptionFallbackValue = "claude_subscription";
export const claudeSubscriptionBaseUrl = "https://api.anthropic.com";
// Ask runs up to six tool steps against a large prompt; a reasoning model needs
// more than the default HTTP timeout for the whole loop.
export const claudeSubscriptionMinTimeoutMs = 90_000;

const defaultSimpleModel = "claude-haiku-5-5";
const defaultReasoningModel = "claude-sonnet-5-5";
// Short names from the Claude Code CLI era, still accepted in .env.
const modelAliases: Record<string, string> = {
  haiku: "claude-haiku-5-5",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5"
};

// Subscription (OAuth) requests must look like Claude Code: Anthropic routes
// them by these betas, the user agent and the system prompt's first block, and
// answers anything else with a 401/500 or bills it as "extra usage".
export const claudeCodeOAuthBetas = ["claude-code-20250219", "oauth-2025-04-20"];
const commonBetas = ["interleaved-thinking-2025-05-14", "fine-grained-tool-streaming-2025-05-14"];
export const claudeCodeSystemPrefix = "You are Claude Code, Anthropic's official CLI for Claude.";
// Anthropic's billing classifier treats unprefixed or single-underscore tool
// names as a third-party app; Claude Code's own MCP tools use `mcp__`.
export const claudeOAuthToolPrefix = "mcp__";
// Anthropic rejects OAuth requests whose Claude Code version is far behind the
// current release, so the installed CLI's version is used when there is one.
const claudeCodeVersionFallback = "2.1.318";

export function isClaudeSubscriptionFallbackEnabled(env: WorkspaceEnv): boolean {
  return env.AI_FINANCES_LLM_FALLBACK?.trim() === claudeSubscriptionFallbackValue;
}

export function resolveClaudeModelId(model: string): string {
  const trimmed = model.trim();
  return modelAliases[trimmed.toLowerCase()] ?? trimmed;
}

export function selectClaudeSubscriptionModel(env: WorkspaceEnv, useCase: "default" | "reasoning" | "simple"): string {
  if (useCase === "simple") {
    return resolveClaudeModelId(env.AI_FINANCES_CLAUDE_SIMPLE_MODEL?.trim() || defaultSimpleModel);
  }

  return resolveClaudeModelId(env.AI_FINANCES_CLAUDE_REASONING_MODEL?.trim() || defaultReasoningModel);
}

// ---------------------------------------------------------------------------
// Claude Code identity: headers
// ---------------------------------------------------------------------------

let claudeCodeVersion: Promise<string> | null = null;

function detectClaudeCodeVersion(env: WorkspaceEnv): Promise<string> {
  const configured = env.AI_FINANCES_CLAUDE_CODE_VERSION?.trim();

  if (configured) {
    return Promise.resolve(configured);
  }

  claudeCodeVersion ??= new Promise((resolve) => {
    execFile(
      env.AI_FINANCES_CLAUDE_CLI_PATH?.trim() || "claude",
      ["--version"],
      { timeout: 5_000 },
      (error, stdout) => {
        const version = error ? "" : String(stdout).trim().split(/\s+/)[0] ?? "";
        resolve(/^\d+\.\d+\.\d+/.test(version) ? version : claudeCodeVersionFallback);
      }
    );
  });

  return claudeCodeVersion;
}

export function claudeCodeUserAgent(version: string): string {
  return `claude-code/${version} (external, cli)`;
}

/** Rewrites one outgoing request's headers into the Claude Code OAuth shape. */
export function applyClaudeCodeHeaders(headers: Headers, accessToken: string, version: string): Headers {
  const next = new Headers(headers);
  const betas = new Set(
    (next.get("anthropic-beta") ?? "")
      .split(",")
      .map((beta) => beta.trim())
      .filter(Boolean)
  );

  for (const beta of [...commonBetas, ...claudeCodeOAuthBetas]) {
    betas.add(beta);
  }

  next.delete("x-api-key");
  next.set("authorization", `Bearer ${accessToken}`);
  next.set("anthropic-beta", [...betas].join(","));
  next.set("user-agent", claudeCodeUserAgent(version));
  next.set("x-app", "cli");
  return next;
}

/**
 * Fetch for the Anthropic provider: attaches the subscription token and the
 * Claude Code headers, and on a 401 refreshes the token once and retries.
 */
export function createClaudeOAuthFetch(
  env: WorkspaceEnv,
  options: { baseFetch?: FetchLike; resolveToken?: typeof resolveClaudeAccessToken } = {}
): FetchLike {
  const baseFetch = options.baseFetch ?? fetch;
  const resolveToken = options.resolveToken ?? resolveClaudeAccessToken;

  return async (input, init) => {
    const version = await detectClaudeCodeVersion(env);
    const credential = await resolveToken({ env });
    const send = (token: string) =>
      baseFetch(input, { ...init, headers: applyClaudeCodeHeaders(new Headers(init?.headers), token, version) });
    const response = await send(credential.accessToken);

    if (response.status !== 401 || (credential.source !== "oauth_login")) {
      return response;
    }

    let refreshed;

    try {
      refreshed = await resolveToken({ env, forceRefresh: true });
    } catch (error) {
      if (error instanceof ClaudeCredentialError) {
        return response;
      }

      throw error;
    }

    return send(refreshed.accessToken);
  };
}

// ---------------------------------------------------------------------------
// Claude Code identity: system prompt and tool names
// ---------------------------------------------------------------------------

export function toClaudeOAuthToolName(name: string): string {
  if (name.startsWith(claudeOAuthToolPrefix)) {
    return name;
  }

  return claudeOAuthToolPrefix + name.replace(/^mcp_/, "");
}

/**
 * Prefixes the system prompt with Claude Code's identity block and renames every
 * tool (definitions, tool choice and replayed tool calls) to its `mcp__` wire
 * name. Returns the params and the map back to the app's own tool names.
 */
export function applyClaudeCodeIdentity(params: CallOptions): { params: CallOptions; toAppName: Map<string, string> } {
  const toAppName = new Map<string, string>();
  const wire = (name: string) => {
    const wireName = toClaudeOAuthToolName(name);
    toAppName.set(wireName, name);
    return wireName;
  };

  const tools = params.tools?.map((tool) => (tool.type === "function" ? { ...tool, name: wire(tool.name) } : tool));
  const toolChoice =
    params.toolChoice?.type === "tool" ? { ...params.toolChoice, toolName: wire(params.toolChoice.toolName) } : params.toolChoice;
  const prompt = params.prompt.map((message) => {
    if (message.role !== "assistant" && message.role !== "tool") {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part) =>
        "toolName" in part && typeof part.toolName === "string" ? { ...part, toolName: wire(part.toolName) } : part
      )
    } as typeof message;
  });

  return {
    params: {
      ...params,
      prompt: [{ content: claudeCodeSystemPrefix, role: "system" }, ...prompt],
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { toolChoice } : {})
    },
    toAppName
  };
}

function appToolName(toAppName: Map<string, string>, wireName: string): string {
  return toAppName.get(wireName) ?? (wireName.startsWith(claudeOAuthToolPrefix) ? wireName.slice(claudeOAuthToolPrefix.length) : wireName);
}

const toolNameMaps = new WeakMap<object, Map<string, string>>();

export const claudeCodeIdentityMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const { params: next, toAppName } = applyClaudeCodeIdentity(params);
    toolNameMaps.set(next, toAppName);
    return next;
  },
  wrapGenerate: async ({ doGenerate, params }) => {
    const toAppName = toolNameMaps.get(params) ?? new Map<string, string>();
    const result = await doGenerate();
    return {
      ...result,
      content: result.content.map((part) =>
        part.type === "tool-call" ? { ...part, toolName: appToolName(toAppName, part.toolName) } : part
      )
    };
  },
  wrapStream: async ({ doStream, params }) => {
    const toAppName = toolNameMaps.get(params) ?? new Map<string, string>();
    const { stream, ...rest } = await doStream();
    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if ((part.type === "tool-call" || part.type === "tool-input-start") && "toolName" in part) {
              controller.enqueue({ ...part, toolName: appToolName(toAppName, part.toolName) });
              return;
            }

            controller.enqueue(part);
          }
        })
      )
    };
  }
};

/**
 * A plain AI SDK model on Anthropic's Messages API, authenticated as the user's
 * Claude subscription. AI SDK tools pass straight through, so Ask's tools run.
 */
export function createClaudeSubscriptionLanguageModel(model: string, env: WorkspaceEnv, fetcher?: FetchLike): LanguageModel {
  const anthropic = createAnthropic({
    // Replaced per request by the OAuth fetch; present so the provider does not
    // look for ANTHROPIC_API_KEY.
    authToken: "claude-subscription",
    baseURL: `${claudeSubscriptionBaseUrl}/v1`,
    fetch: createClaudeOAuthFetch(env, { baseFetch: fetcher })
  });

  return wrapLanguageModel({
    middleware: claudeCodeIdentityMiddleware,
    // @ai-sdk/anthropic ships a newer @ai-sdk/provider patch than `ai` pins;
    // both are the same v4 model spec and differ only in JSON metadata typings.
    model: anthropic(resolveClaudeModelId(model)) as unknown as Parameters<typeof wrapLanguageModel>[0]["model"]
  });
}
