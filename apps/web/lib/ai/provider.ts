import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  asSchema,
  generateObject,
  generateText,
  NoObjectGeneratedError,
  streamText as streamAiText,
  type FinishReason,
  type LanguageModel
} from "ai";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  chatGptAccountIdFromToken,
  chatGptCodexBaseUrl,
  codexClientVersion,
  getFreshChatGptOAuthAccessToken
} from "@/lib/ai/chatgpt-oauth";
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
    if (provider.credentialSource === "chatgpt_oauth") {
      return generateObjectWithChatGptResponses({
        env,
        fetcher,
        maxOutputTokens,
        messages,
        provider,
        schema,
        schemaName
      });
    }

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
    if (provider.credentialSource === "chatgpt_oauth") {
      const result = await generateTextWithChatGptResponses({
        env,
        fetcher,
        maxOutputTokens,
        messages,
        provider
      });

      if (result.finishReason === "length" && !allowLengthFinish) {
        throw new AiLlmOutputError("LLM provider stopped before returning complete response.");
      }

      if (result.text.trim().length === 0) {
        throw new AiLlmOutputError("LLM provider returned no message content.");
      }

      return result;
    }

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
    if (provider.credentialSource === "chatgpt_oauth") {
      const result = await generateTextWithChatGptResponses({
        env,
        fetcher,
        maxOutputTokens,
        messages,
        provider
      });

      if (result.finishReason === "length" && !allowLengthFinish) {
        throw new AiLlmOutputError("LLM provider stopped before returning complete response.");
      }

      if (result.text.trim().length === 0) {
        throw new AiLlmOutputError("LLM provider returned no message content.");
      }

      return singleChunkTextStream(result.text);
    }

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

function singleChunkTextStream(text: string): LlmTextStreamResult {
  return {
    getText: () => Promise.resolve(text),
    textStream: (async function* streamSingleChunk() {
      yield text;
    })()
  };
}

function buildConfiguredLanguageModel(
  provider: LlmProviderStatus,
  env: WorkspaceEnv,
  fetcher?: FetchLike
): Promise<LanguageModel> {
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

async function generateTextWithChatGptResponses({
  env,
  fetcher,
  maxOutputTokens,
  messages,
  provider
}: LlmTextGenerationInput): Promise<LlmTextGenerationResult> {
  const response = await callChatGptResponses({
    env,
    fetcher,
    maxOutputTokens,
    messages,
    provider
  });

  return {
    finishReason: response.finishReason,
    text: response.text
  };
}

async function generateObjectWithChatGptResponses<TSchema extends z.ZodTypeAny>({
  env,
  fetcher,
  maxOutputTokens,
  messages,
  provider,
  schema,
  schemaName
}: LlmObjectGenerationInput<TSchema>): Promise<LlmObjectGenerationResult<z.infer<TSchema>>> {
  const response = await callChatGptResponses({
    env,
    fetcher,
    jsonSchema: await asSchema(schema).jsonSchema,
    maxOutputTokens,
    messages,
    provider,
    schemaName
  });

  if (response.finishReason === "length") {
    throw new AiLlmOutputError("LLM provider stopped before returning complete JSON.");
  }

  const parsed = parseJsonObject(response.text);
  const validation = schema.safeParse(parsed);

  if (!validation.success) {
    throw new AiLlmOutputError(validation.error.message);
  }

  return {
    finishReason: response.finishReason,
    object: validation.data
  };
}

async function callChatGptResponses({
  env,
  fetcher = fetch,
  jsonSchema,
  maxOutputTokens,
  messages,
  provider,
  schemaName
}: {
  env: WorkspaceEnv;
  fetcher?: FetchLike;
  jsonSchema?: unknown;
  maxOutputTokens: number;
  messages: LlmChatMessage[];
  provider: LlmProviderStatus;
  schemaName?: string;
}): Promise<{ finishReason: FinishReason; text: string }> {
  if (!provider.model) {
    throw new Error("No LLM model is configured.");
  }

  const accessToken = await getFreshChatGptOAuthAccessToken(env, fetcher);

  if (!accessToken) {
    throw new Error("ChatGPT OAuth is enabled but no usable token is saved.");
  }

  // The Codex backend requires the account-id header, the codex client headers,
  // and a client_version query param — without them it returns HTTP 400.
  const accountId = chatGptAccountIdFromToken(accessToken);
  const url = `${chatGptCodexBaseUrl}/responses?client_version=${codexClientVersion}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    session_id: randomUUID(),
    ...(accountId ? { "chatgpt-account-id": accountId } : {})
  };
  const body = chatGptResponsesRequestBody({ jsonSchema, maxOutputTokens, messages, model: provider.model, schemaName });

  // The Codex backend rejects params the platform Responses API accepts (e.g.
  // max_output_tokens) with 400 "Unsupported parameter: X". Strip the named
  // param and retry — capability negotiation, bounded so it can't loop.
  let parsed: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetcher(url, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(provider.timeoutMs)
    });

    if (response.ok) {
      parsed = await readFinalResponsesEvent(response);
      break;
    }

    const detail = await response.text().catch(() => "");
    const unsupported = /Unsupported parameter:\s*([a-zA-Z0-9_]+)/.exec(detail)?.[1];
    if (unsupported && unsupported in body && attempt < 4) {
      delete body[unsupported];
      continue;
    }

    throw new Error(`ChatGPT OAuth Responses request failed with status ${response.status}.${detail ? ` ${detail.slice(0, 300)}` : ""}`);
  }

  if (!parsed) {
    throw new Error("ChatGPT OAuth Responses request could not be completed after stripping unsupported parameters.");
  }

  // The backend streams SSE; the final `response.completed` event carries the
  // full response object, which the existing extractors understand.
  const text = extractResponsesText(parsed);

  if (!text) {
    throw new AiLlmOutputError("LLM provider returned no message content.");
  }

  return {
    finishReason: responsesFinishReason(parsed),
    text
  };
}

function chatGptResponsesRequestBody({
  jsonSchema,
  maxOutputTokens,
  messages,
  model,
  schemaName
}: {
  jsonSchema?: unknown;
  maxOutputTokens: number;
  messages: LlmChatMessage[];
  model: string;
  schemaName?: string;
}): Record<string, unknown> {
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => message.content.trim());
  const inputMessages = messages.filter((message) => message.role !== "system");
  const body: Record<string, unknown> = {
    input: inputMessages.map((message) => ({
      content: [
        {
          text: message.content,
          type: "input_text"
        }
      ],
      role: message.role
    })),
    max_output_tokens: maxOutputTokens,
    model,
    // The Codex backend only accepts streaming requests (rejects stream:false
    // with "Stream must be set to true"); the SSE is reassembled at the caller.
    stream: true,
    store: false
  };

  if (systemMessages.length > 0) {
    body.instructions = systemMessages.join("\n\n");
  }

  if (!usesCompletionTokenParameter(model)) {
    body.temperature = 0.1;
  }

  if (jsonSchema && schemaName) {
    body.text = {
      format: {
        name: schemaName,
        schema: jsonSchema,
        strict: true,
        type: "json_schema"
      }
    };
  }

  return body;
}

/**
 * The Codex backend only streams (SSE). Buffer it and return the final
 * response object from the `response.completed` event so the existing
 * extractors work unchanged; fall back to accumulated text deltas, and to plain
 * JSON when the body isn't SSE (e.g. a mocked fetch in tests).
 */
async function readFinalResponsesEvent(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();

  if (!raw.includes("data:")) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { output_text: "" };
    }
  }

  let deltas = "";
  let finalResponse: Record<string, unknown> | undefined;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    if ((event.type === "response.completed" || event.type === "response.done") && event.response && typeof event.response === "object") {
      finalResponse = event.response as Record<string, unknown>;
    } else if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      deltas += event.delta;
    }
  }

  // Prefer the completed event's response object (carries finish reason etc.),
  // but the actual text arrives as streamed deltas — fall back to those when the
  // final object has no inline text (the common case for this backend).
  if (finalResponse) {
    return extractResponsesText(finalResponse) ? finalResponse : { ...finalResponse, output_text: deltas };
  }

  return { output_text: deltas };
}

function extractResponsesText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") {
    return response.output_text.trim();
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const text = (part as { text?: unknown }).text;

      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }

  return chunks.join("").trim();
}

function responsesFinishReason(response: Record<string, unknown>): FinishReason {
  return response.status === "incomplete" ? "length" : "stop";
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new AiLlmOutputError("LLM provider did not return valid JSON.");
  }
}
