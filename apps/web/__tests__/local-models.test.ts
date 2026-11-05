// @vitest-environment node

import { describe, expect, it } from "vitest";
import { listLocalModels, ollamaTagsUrl, openAiModelsUrl } from "@/lib/ai/local-models";
import { applyLlmSettingsToEnv, isPrivateNetworkUrl, parseStoredLlmSettings, toPublicLlmSettings } from "@/lib/ai/llm-settings";
import { aiSdkLlmClient, isLocalLlmProvider, localModelSampling } from "@/lib/ai/provider";
import { getLlmEnrichmentStatus } from "@/lib/llm-enrichment";

const cloudEnv = {
  AI_FINANCES_ENABLE_CHATGPT_OAUTH: "1",
  AI_FINANCES_LLM_FALLBACK: "claude_subscription",
  AI_FINANCES_LLM_MODEL: "gpt-5.5",
  AI_FINANCES_LLM_PROVIDER: "openai_compatible",
  AI_FINANCES_LLM_REASONING_MODEL: "gpt-5.5",
  OPENAI_API_KEY: "sk-test"
};

describe("local model settings", () => {
  it("points Ask at Ollama and drops every cloud credential and the Claude fallback", () => {
    const env = applyLlmSettingsToEnv(cloudEnv, { choice: "ollama", model: "llama3.2" });

    expect(env).toMatchObject({
      AI_FINANCES_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      AI_FINANCES_LLM_MODEL: "llama3.2",
      AI_FINANCES_LLM_PROVIDER: "ollama"
    });
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("AI_FINANCES_LLM_FALLBACK");
    expect(env).not.toHaveProperty("AI_FINANCES_ENABLE_CHATGPT_OAUTH");
    expect(env).not.toHaveProperty("AI_FINANCES_LLM_REASONING_MODEL");

    const status = getLlmEnrichmentStatus(env, "reasoning");
    expect(status).toMatchObject({
      baseUrl: "http://127.0.0.1:11434/v1",
      configured: true,
      credentialSource: "ollama",
      model: "llama3.2",
      provider: "ollama"
    });
    expect(status.fallback).toBeUndefined();
  });

  it("runs a keyless OpenAI-compatible server on a private address as a local model", () => {
    const env = applyLlmSettingsToEnv(cloudEnv, { baseUrl: "http://127.0.0.1:8099/v1", choice: "openai_compatible", model: "lfm3-1.7b" });
    const status = getLlmEnrichmentStatus(env, "reasoning");

    expect(status).toMatchObject({ baseUrl: "http://127.0.0.1:8099/v1", configured: true, credentialSource: "local", model: "lfm3-1.7b" });
    expect(isLocalLlmProvider(status)).toBe(true);
  });

  it("sends the saved key to a server that needs one", () => {
    const env = applyLlmSettingsToEnv(cloudEnv, {
      apiKey: "lm-key",
      baseUrl: "http://192.168.1.20:1234/v1",
      choice: "openai_compatible",
      model: "qwen"
    });
    expect(env.AI_FINANCES_LLM_API_KEY).toBe("lm-key");
    expect(getLlmEnrichmentStatus(env).credentialSource).toBe("openai_api_key");
  });

  it("says ChatGPT needs a sign-in instead of asking for an OpenAI key", () => {
    const status = getLlmEnrichmentStatus(applyLlmSettingsToEnv(cloudEnv, { choice: "chatgpt" }));
    expect(status).toMatchObject({ configured: false, status: "not_configured" });
    expect(status.errorMessage).toContain("Sign in to ChatGPT");
  });

  it("chooses the Claude subscription over an OpenAI key", () => {
    const status = getLlmEnrichmentStatus(applyLlmSettingsToEnv(cloudEnv, { choice: "claude", model: "opus" }), "reasoning");
    expect(status).toMatchObject({ credentialSource: "claude_subscription", model: "claude-opus-5-5", provider: "claude_subscription" });
  });

  it("never returns the saved key to the browser", () => {
    const stored = parseStoredLlmSettings(JSON.stringify({ apiKey: "secret", baseUrl: "http://10.0.0.2:8000/v1", choice: "openai_compatible", model: "m" }));
    expect(toPublicLlmSettings(stored)).toEqual({ base_url: "http://10.0.0.2:8000/v1", choice: "openai_compatible", has_api_key: true, model: "m" });
    expect(parseStoredLlmSettings(JSON.stringify({ choice: "gemini" }))).toBeNull();
    expect(toPublicLlmSettings(null)).toEqual({ choice: "env", has_api_key: false });
  });

  it("treats loopback, LAN and Tailscale hosts as private", () => {
    for (const url of ["http://127.0.0.1:8099/v1", "http://localhost:11434", "http://10.1.2.3/v1", "http://192.168.0.5", "http://100.95.116.10:8080", "http://rivendell.tail1234.ts.net/v1"]) {
      expect(isPrivateNetworkUrl(url)).toBe(true);
    }
    for (const url of ["https://api.openai.com/v1", "http://8.8.8.8", "http://100.200.1.1", "not a url"]) {
      expect(isPrivateNetworkUrl(url)).toBe(false);
    }
  });
});

describe("LFM sampling", () => {
  it("applies the model card's sampling to LFM-family models on local servers only", () => {
    expect(localModelSampling({ baseUrl: "http://127.0.0.1:8099/v1", model: "lfm3-1.7b", provider: "openai_compatible" })).toEqual({
      repeat_penalty: 1.1,
      repetition_penalty: 1.1,
      top_k: 50
    });
    expect(localModelSampling({ baseUrl: "http://127.0.0.1:11434/v1", model: "hf.co/LiquidAI/LFM2-1.2B-GGUF", provider: "ollama" })).toBeDefined();
    expect(localModelSampling({ baseUrl: "http://127.0.0.1:8099/v1", model: "qwen3-8b", provider: "openai_compatible" })).toBeUndefined();
    expect(localModelSampling({ baseUrl: "https://api.example.com/v1", model: "lfm3-1.7b", provider: "openai_compatible" })).toBeUndefined();
  });

  it("sends temperature 0.1, top_k and repetition penalty with thinking left on", async () => {
    let body: Record<string, unknown> = {};
    const env = applyLlmSettingsToEnv({}, { baseUrl: "http://127.0.0.1:8099/v1", choice: "openai_compatible", model: "lfm3-1.7b" });

    await aiSdkLlmClient.generateText({
      env,
      fetcher: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          choices: [{ finish_reason: "stop", index: 0, message: { content: "ok", role: "assistant" } }],
          created: 0,
          id: "c",
          model: "lfm3-1.7b",
          object: "chat.completion"
        });
      },
      maxOutputTokens: 16,
      messages: [{ content: "hi", role: "user" }],
      provider: getLlmEnrichmentStatus(env)
    });

    expect(body).toMatchObject({ model: "lfm3-1.7b", repeat_penalty: 1.1, repetition_penalty: 1.1, temperature: 0.1, top_k: 50 });
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});

describe("listing local models", () => {
  it("reads Ollama's installed models from /api/tags outside the /v1 prefix", async () => {
    expect(ollamaTagsUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/api/tags");
    expect(ollamaTagsUrl("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434/api/tags");
    let asked = "";
    const listing = await listLocalModels("ollama", "http://127.0.0.1:11434/v1", {
      fetcher: async (input) => {
        asked = String(input);
        return Response.json({ models: [{ model: "qwen3:8b", name: "qwen3:8b" }, { name: "llama3.2:latest" }] });
      }
    });
    expect(asked).toBe("http://127.0.0.1:11434/api/tags");
    expect(listing.models).toEqual(["llama3.2:latest", "qwen3:8b"]);
  });

  it("reads an OpenAI-compatible server's /models with its key", async () => {
    expect(openAiModelsUrl("http://127.0.0.1:8099/v1/")).toBe("http://127.0.0.1:8099/v1/models");
    let authorization: string | null = null;
    const listing = await listLocalModels("openai_compatible", "http://127.0.0.1:8099/v1", {
      apiKey: "k",
      fetcher: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        return Response.json({ data: [{ id: "lfm3-1.7b" }], object: "list" });
      }
    });
    expect(authorization).toBe("Bearer k");
    expect(listing.models).toEqual(["lfm3-1.7b"]);
  });

  it("surfaces an unreachable or failing server", async () => {
    await expect(
      listLocalModels("ollama", "http://127.0.0.1:11434/v1", { fetcher: async () => new Response("no", { status: 500 }) })
    ).rejects.toThrow("HTTP 500");
  });
});
