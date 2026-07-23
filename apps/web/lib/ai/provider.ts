import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateObject,
  generateText,
  NoObjectGeneratedError,
  streamText as streamAiText,
  type FinishReason,
  type LanguageModel
} from "ai";
import type { z } from "zod";
import { createChatGptLanguageModel } from "@/lib/ai/chatgpt-oauth";
import type { LlmChatMessage, LlmProviderStatus } from "@/lib/llm-enrichment";
import type { WorkspaceEnv } from "@/lib/workspace-env";

type FetchLike = typeof fetch;

export interface LlmTextGenerationInput {
  allowLengthFinish?: boolean;
  env: WorkspaceEnv;
  fetcher?: FetchLike;
  maxOutputTokens: number;
  messages: LlmChatMessage[];
  provider: LlmProviderStatus;
}

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
  textStream: AsyncIterable<string>;
}

export interface LlmObjectGenerationResult<TObject> {
  finishReason: FinishReason;
  object: TObject;
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
      const result = await generateObject({
        abortSignal: AbortSignal.timeout(provider.timeoutMs),
        allowSystemInMessages: true,
        maxOutputTokens,
        maxRetries: 0,
        messages,
        model: await buildConfiguredLanguageModel(provider, env, fetcher),
        schema,
        schemaName,
        ...samplingOptions(provider)
      });

      if (result.finishReason === "length") {
        throw new AiLlmOutputError("LLM provider stopped before returning complete JSON.");
      }

      return {
        finishReason: result.finishReason,
        object: result.object
      };
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
    const result = await generateText({
      allowSystemInMessages: true,
      maxOutputTokens,
      maxRetries: 0,
      messages,
      model: await buildConfiguredLanguageModel(provider, env, fetcher),
      timeout: { totalMs: provider.timeoutMs },
      ...samplingOptions(provider)
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
  },

  async streamText({
    allowLengthFinish = false,
    env,
    fetcher,
    maxOutputTokens,
    messages,
    provider
  }: LlmTextGenerationInput) {
    const result = streamAiText({
      allowSystemInMessages: true,
      maxOutputTokens,
      maxRetries: 0,
      messages,
      model: await buildConfiguredLanguageModel(provider, env, fetcher),
      timeout: { totalMs: provider.timeoutMs },
      ...samplingOptions(provider)
    });
    const textPromise = Promise.resolve(result.text);

    return {
      getText: () => textPromise,
      textStream: result.textStream
    };
  }
};

function buildConfiguredLanguageModel(
  provider: LlmProviderStatus,
  env: WorkspaceEnv,
  fetcher?: FetchLike
): Promise<LanguageModel> {
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

function samplingOptions(provider: LlmProviderStatus): { temperature?: number } {
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
  return /^(?:gpt-5|gpt-4\.1|gpt-4o|o[134])(?:[.\-]|$)/i.test(model);
}

function usesCompletionTokenParameter(model: string): boolean {
  return /^gpt-5(?:[.\-]|$)/i.test(model);
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
