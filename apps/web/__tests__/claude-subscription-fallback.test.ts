import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn()
}));
const claudeModel = vi.hoisted(() => ({ id: "claude-subscription-model" }));
const createClaudeSubscriptionLanguageModel = vi.hoisted(() => vi.fn(() => claudeModel));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: aiMocks.generateObject,
  generateText: aiMocks.generateText
}));

vi.mock("@/lib/ai/claude-subscription", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/claude-subscription")>()),
  createClaudeSubscriptionLanguageModel
}));

import { z } from "zod";
import { aiSdkLlmClient, AiLlmOutputError } from "@/lib/ai/provider";
import { getLlmEnrichmentStatus, type LlmProviderStatus } from "@/lib/llm-enrichment";

const env = { OPENAI_API_KEY: "sk-test" };
const messages = [{ content: "Categorize.", role: "user" as const }];

function providerStatus(overrides: Partial<LlmProviderStatus> = {}): LlmProviderStatus {
  return {
    baseUrl: "https://api.openai.com/v1",
    configured: true,
    credentialSource: "openai_api_key",
    model: "gpt-5-mini",
    provider: "openai_compatible",
    status: "stale",
    timeoutMs: 20_000,
    ...overrides
  };
}

const withFallback = { fallback: { model: "haiku", provider: "claude_subscription" as const } };

describe("Claude subscription fallback", () => {
  beforeEach(() => {
    aiMocks.generateObject.mockReset();
    aiMocks.generateText.mockReset();
    createClaudeSubscriptionLanguageModel.mockClear();
  });

  it("retries a failed primary text call on the Claude subscription", async () => {
    aiMocks.generateText
      .mockRejectedValueOnce(new Error("The usage limit has been reached"))
      .mockResolvedValueOnce({ finishReason: "stop", text: "groceries" });

    const result = await aiSdkLlmClient.generateText({
      env,
      maxOutputTokens: 64,
      messages,
      provider: providerStatus(withFallback)
    });

    expect(result).toEqual({ finishReason: "stop", text: "groceries" });
    expect(createClaudeSubscriptionLanguageModel).toHaveBeenCalledWith("haiku", env);
    const fallbackCall = aiMocks.generateText.mock.calls[1][0];
    expect(fallbackCall.model).toBe(claudeModel);
    expect(fallbackCall.timeout).toEqual({ totalMs: 90_000 });
    expect(fallbackCall).not.toHaveProperty("temperature");
  });

  it("retries a failed primary object call on the Claude subscription", async () => {
    aiMocks.generateObject
      .mockRejectedValueOnce(new Error("The usage limit has been reached"))
      .mockResolvedValueOnce({ finishReason: "stop", object: { suggestions: [] } });

    const result = await aiSdkLlmClient.generateObject({
      env,
      maxOutputTokens: 256,
      messages,
      provider: providerStatus(withFallback),
      schema: z.object({ suggestions: z.array(z.string()) }),
      schemaName: "suggestions"
    });

    expect(result.object).toEqual({ suggestions: [] });
    expect(result.servedBy).toEqual({ model: "haiku", provider: "claude_subscription" });
    expect(aiMocks.generateObject.mock.calls[1][0].model).toBe(claudeModel);
  });

  it("reports no fallback when the primary answers", async () => {
    aiMocks.generateObject.mockResolvedValueOnce({ finishReason: "stop", object: { suggestions: [] } });

    const result = await aiSdkLlmClient.generateObject({
      env,
      maxOutputTokens: 256,
      messages,
      provider: providerStatus(withFallback),
      schema: z.object({ suggestions: z.array(z.string()) }),
      schemaName: "suggestions"
    });

    expect(result.servedBy).toBeUndefined();
    expect(createClaudeSubscriptionLanguageModel).not.toHaveBeenCalled();
  });

  it("surfaces the primary failure when no fallback is configured", async () => {
    aiMocks.generateText.mockRejectedValueOnce(new Error("The usage limit has been reached"));

    await expect(
      aiSdkLlmClient.generateText({ env, maxOutputTokens: 64, messages, provider: providerStatus() })
    ).rejects.toThrow("The usage limit has been reached");
    expect(createClaudeSubscriptionLanguageModel).not.toHaveBeenCalled();
  });

  it("does not retry output errors from a primary that answered", async () => {
    aiMocks.generateText.mockResolvedValueOnce({ finishReason: "stop", text: "  " });

    await expect(
      aiSdkLlmClient.generateText({ env, maxOutputTokens: 64, messages, provider: providerStatus(withFallback) })
    ).rejects.toBeInstanceOf(AiLlmOutputError);
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);
  });
});

describe("Claude subscription fallback status", () => {
  const fallbackEnv = { ...env, AI_FINANCES_LLM_FALLBACK: "claude_subscription", AI_FINANCES_LLM_MODEL: "gpt-5-mini" };

  it("is absent unless opted in", () => {
    expect(getLlmEnrichmentStatus({ ...env, AI_FINANCES_LLM_MODEL: "gpt-5-mini" }).fallback).toBeUndefined();
  });

  it("uses Haiku for simple work and Sonnet for reasoning by default", () => {
    expect(getLlmEnrichmentStatus(fallbackEnv, "simple").fallback).toEqual({
      model: "claude-haiku-5-5",
      provider: "claude_subscription"
    });
    expect(getLlmEnrichmentStatus(fallbackEnv, "reasoning").fallback?.model).toBe("claude-sonnet-5-5");
  });

  it("resolves the CLI-era short names to API model ids", () => {
    expect(getLlmEnrichmentStatus({ ...fallbackEnv, AI_FINANCES_CLAUDE_REASONING_MODEL: "opus" }, "reasoning").fallback?.model)
      .toBe("claude-opus-5-5");
  });

  it("honors configured Claude models", () => {
    const status = getLlmEnrichmentStatus(
      { ...fallbackEnv, AI_FINANCES_CLAUDE_SIMPLE_MODEL: "claude-haiku-4-5" },
      "simple"
    );
    expect(status.fallback?.model).toBe("claude-haiku-4-5");
  });
});

describe("Claude subscription as the chosen provider", () => {
  const claudeEnv = { ...env, AI_FINANCES_LLM_PROVIDER: "claude_subscription" };

  beforeEach(() => {
    aiMocks.generateText.mockReset();
    createClaudeSubscriptionLanguageModel.mockClear();
  });

  it("wins over an OpenAI key and uses the subscription models", () => {
    const simple = getLlmEnrichmentStatus(claudeEnv, "simple");

    expect(simple).toMatchObject({
      baseUrl: "https://api.anthropic.com",
      configured: true,
      credentialSource: "claude_subscription",
      model: "claude-haiku-5-5",
      provider: "claude_subscription",
      timeoutMs: 90_000
    });
    expect(getLlmEnrichmentStatus(claudeEnv, "reasoning").model).toBe("claude-sonnet-5-5");
  });

  it("sends calls straight to Claude without sampling overrides", async () => {
    aiMocks.generateText.mockResolvedValueOnce({ finishReason: "stop", text: "groceries" });

    await aiSdkLlmClient.generateText({
      env: claudeEnv,
      maxOutputTokens: 64,
      messages,
      provider: getLlmEnrichmentStatus(claudeEnv, "simple")
    });

    expect(createClaudeSubscriptionLanguageModel).toHaveBeenCalledWith("claude-haiku-5-5", claudeEnv);
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);
    expect(aiMocks.generateText.mock.calls[0][0]).not.toHaveProperty("temperature");
  });
});
