import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateObject,
  generateText,
  isStepCount,
  NoObjectGeneratedError,
  streamText as streamAiText,
  type FinishReason,
  type LanguageModel,
  type TextStreamPart,
  type ToolSet
} from "ai";
import type { z } from "zod";
import { createChatGptLanguageModel } from "@/lib/ai/chatgpt-oauth";
import {
  claudeSubscriptionMinTimeoutMs,
  createClaudeSubscriptionLanguageModel
} from "@/lib/ai/claude-subscription";
import type { LlmChatMessage, LlmFallbackStatus, LlmProviderStatus } from "@/lib/llm-enrichment";
import type { WorkspaceEnv } from "@/lib/workspace-env";

type FetchLike = typeof fetch;

interface ModelCall {
  model: LanguageModel;
  sampling: { temperature?: number };
  servedBy?: LlmFallbackStatus;
  timeoutMs: number;
}

export interface LlmTextGenerationInput {
  allowLengthFinish?: boolean;
  env: WorkspaceEnv;
  fetcher?: FetchLike;
  maxOutputTokens: number;
  messages: LlmChatMessage[];
  provider: LlmProviderStatus;
  /** Tools the model may call while streaming; each call is reported in `parts`. */
  tools?: ToolSet;
}

export type LlmStreamPart =
  | { text: string; type: "text" }
  | { input: unknown; toolName: string; type: "tool-call" };

export interface LlmObjectGenerationInput<TSchema extends z.ZodTypeAny> {
  env: WorkspaceEnv;
  fetcher?: FetchLike;
  maxOutputTokens: number;
  messages: LlmChatMessage[];
  provider: LlmProviderStatus;
  schema: TSchema;
  schemaName: string;
}

export interface LlmTextGenerationResult {
  finishReason: FinishReason;
  text: string;
}

export interface LlmTextStreamResult {
  getText: () => Promise<string>;
  parts: AsyncIterable<LlmStreamPart>;
  textStream: AsyncIterable<string>;
}

export interface LlmObjectGenerationResult<TObject> {
  finishReason: FinishReason;
  object: TObject;
  servedBy?: LlmFallbackStatus;
}

export interface LlmGenerationClient {
  generateObject<TSchema extends z.ZodTypeAny>(
    input: LlmObjectGenerationInput<TSchema>
  ): Promise<LlmObjectGenerationResult<z.infer<TSchema>>>;
  generateText(input: LlmTextGenerationInput): Promise<LlmTextGenerationResult>;
  streamText(input: LlmTextGenerationInput): Promise<LlmTextStreamResult>;
}

export class AiLlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiLlmOutputError";
  }
}

export function isAiLlmOutputError(error: unknown): boolean {
  return error instanceof AiLlmOutputError || NoObjectGeneratedError.isInstance(error);
}

export const aiSdkLlmClient: LlmGenerationClient = {
  async generateObject<TSchema extends z.ZodTypeAny>({
    env,
    fetcher,
    maxOutputTokens,
    messages,
    provider,
    schema,
    schemaName
  }: LlmObjectGenerationInput<TSchema>) {
    try {
      return await withSubscriptionFallback(provider, env, fetcher, async ({ model, sampling, servedBy, timeoutMs }) => {
        const result = await generateObject({
          abortSignal: AbortSignal.timeout(timeoutMs),
          allowSystemInMessages: true,
          maxOutputTokens,
          maxRetries: 0,
          messages,
          model,
          schema,
          schemaName,
          ...sampling
        });

        if (result.finishReason === "length") {
          throw new AiLlmOutputError("LLM provider stopped before returning complete JSON.");
        }

        return {
          finishReason: result.finishReason,
          object: result.object,
          ...(servedBy ? { servedBy } : {})
        };
      });
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        throw new AiLlmOutputError(error.message);
      }

      throw error;
    }
  },

  async generateText({
    allowLengthFinish = false,
    env,
    fetcher,
    maxOutputTokens,
    messages,
    provider
  }: LlmTextGenerationInput) {
    return withSubscriptionFallback(provider, env, fetcher, async ({ model, sampling, timeoutMs }) => {
      const result = await generateText({
        allowSystemInMessages: true,
        maxOutputTokens,
        maxRetries: 0,
        messages,
        model,
        timeout: { totalMs: timeoutMs },
        ...sampling
      });

      if (result.finishReason === "length" && !allowLengthFinish) {
        throw new AiLlmOutputError("LLM provider stopped before returning complete response.");
      }

      if (result.text.trim().length === 0) {
        throw new AiLlmOutputError("LLM provider returned no message content.");
      }

      return {
        finishReason: result.finishReason,
        text: result.text
      };
    });
  },

  async streamText({
    allowLengthFinish = false,
    env,
    fetcher,
    maxOutputTokens,
    messages,
    provider,
    tools
  }: LlmTextGenerationInput) {
    const result = streamAiText({
      allowSystemInMessages: true,
      maxOutputTokens,
      maxRetries: 0,
      messages,
      model: await buildConfiguredLanguageModel(provider, env, fetcher),
      timeout: { totalMs: provider.timeoutMs },
      ...(tools ? { stopWhen: isStepCount(6), tools } : {}),
      ...chatGptMultiStepOptions(provider),
      ...samplingOptions(provider)
    });
    const textPromise = Promise.resolve(result.text);

    return {
      getText: () => textPromise,
      parts: streamParts(result.fullStream),
      textStream: result.textStream
    };
  }
};

// Provider failures (usage limits, auth, network) on the primary model retry
// once on the Claude subscription when configured. Output errors do not: the
// primary answered, and a second model would only mask a prompt problem.
async function withSubscriptionFallback<T>(
  provider: LlmProviderStatus,
  env: WorkspaceEnv,
  fetcher: FetchLike | undefined,
  run: (call: ModelCall) => Promise<T>
): Promise<T> {
  try {
    return await run({
      model: await buildConfiguredLanguageModel(provider, env, fetcher),
      sampling: samplingOptions(provider),
      timeoutMs: provider.timeoutMs
    });
  } catch (error) {
    if (!provider.fallback || isAiLlmOutputError(error)) {
      throw error;
    }

    return run({
      model: createClaudeSubscriptionLanguageModel(provider.fallback.model, env),
      sampling: {},
      servedBy: provider.fallback,
      timeoutMs: Math.max(provider.timeoutMs, claudeSubscriptionMinTimeoutMs)
    });
  }
}

async function* streamParts(fullStream: AsyncIterable<TextStreamPart<ToolSet>>): AsyncGenerator<LlmStreamPart> {
  for await (const part of fullStream) {
    if (part.type === "text-delta") {
      yield { text: part.text, type: "text" };
    } else if (part.type === "tool-call") {
      yield { input: part.input, toolName: part.toolName, type: "tool-call" };
    } else if (part.type === "error") {
      throw part.error;
    }
  }
}

function buildConfiguredLanguageModel(
  provider: LlmProviderStatus,
  env: WorkspaceEnv,
  fetcher?: FetchLike
): Promise<LanguageModel> {
  if (provider.credentialSource === "claude_subscription") {
    if (!provider.model) {
      throw new Error(provider.errorMessage ?? "No LLM model is configured.");
    }

    return Promise.resolve(createClaudeSubscriptionLanguageModel(provider.model, env));
  }

  if (provider.credentialSource === "chatgpt_oauth") {
    if (!provider.model) {
      throw new Error(provider.errorMessage ?? "No LLM model is configured.");
    }

    // The ChatGPT subscription flows through the package's AI SDK provider, so
    // it shares the same generateText/generateObject/streamText calls as every
    // other provider — no bespoke transport.
    return Promise.resolve(createChatGptLanguageModel(provider.model, fetcher));
  }

  if (!provider.configured || !provider.model || !provider.baseUrl) {
    throw new Error(provider.errorMessage ?? "No LLM provider is configured.");
  }

  return Promise.resolve(createOpenAICompatible<string, string, string, string>({
    apiKey: provider.provider === "openai_compatible" ? openAiCompatibleApiKey(env) : undefined,
    baseURL: aiSdkBaseUrl(provider),
    fetch: fetcher,
    name: provider.provider,
    supportsStructuredOutputs:
      provider.provider === "openai_compatible" &&
      isOpenAiBaseUrl(provider.baseUrl) &&
      supportsOpenAiStructuredOutputs(provider.model),
    transformRequestBody: usesCompletionTokenParameter(provider.model)
      ? transformGpt5RequestBody
      : undefined
  }).chatModel(provider.model));
}

// The subscription backend never stores responses, so a second step (after a
// tool call) cannot point back at the first step's reasoning by id. Telling the
// SDK store is off and asking for encrypted reasoning makes it resend the
// reasoning in full instead.
function chatGptMultiStepOptions(provider: LlmProviderStatus) {
  return provider.credentialSource === "chatgpt_oauth"
    ? { providerOptions: { openai: { include: ["reasoning.encrypted_content"], store: false } } }
    : {};
}

function samplingOptions(provider: LlmProviderStatus): { temperature?: number } {
  if (provider.credentialSource === "claude_subscription") {
    return {};
  }

  return provider.model && usesCompletionTokenParameter(provider.model) ? {} : { temperature: 0.1 };
}

function aiSdkBaseUrl(provider: LlmProviderStatus): string {
  const baseUrl = (provider.baseUrl ?? "").replace(/\/+$/, "");

  if (provider.provider !== "ollama") {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");

    if (pathname.endsWith("/v1")) {
      return baseUrl;
    }

    url.pathname = `${pathname}/v1`.replace(/^\/?/, "/");
    return url.toString().replace(/\/$/, "");
  } catch {
    return `${baseUrl}/v1`;
  }
}

function supportsOpenAiStructuredOutputs(model: string): boolean {
  return /^(?:gpt-(?:[5-9]|\d{2,})|gpt-4\.1|gpt-4o|o[134])(?:[.\-]|$)/i.test(model);
}

function usesCompletionTokenParameter(model: string): boolean {
  return /^gpt-(?:[5-9]|\d{2,})(?:[.\-]|$)/i.test(model);
}

function transformGpt5RequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };

  if (typeof next.max_tokens === "number" && typeof next.max_completion_tokens !== "number") {
    next.max_completion_tokens = Math.max(next.max_tokens, 16);
  }

  delete next.max_tokens;
  delete next.temperature;

  return next;
}

function isOpenAiBaseUrl(value: string): boolean {
  try {
    return new URL(value).hostname.endsWith("openai.com");
  } catch {
    return false;
  }
}

function openAiCompatibleApiKey(env: WorkspaceEnv): string | undefined {
  return env.OPENAI_API_KEY?.trim() || env.AI_FINANCES_LLM_API_KEY?.trim() || undefined;
}
