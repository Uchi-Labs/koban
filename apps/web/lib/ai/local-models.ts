type FetchLike = typeof fetch;

export interface LocalModelListing {
  models: string[];
  /** The URL that was asked, for the message shown when it cannot be reached. */
  source: string;
}

/**
 * Ollama's own model list lives at `<origin>/api/tags`, outside the `/v1`
 * OpenAI-compatible prefix that chat requests use.
 */
export function ollamaTagsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") + "/api/tags";
  url.search = "";
  return url.toString();
}

export function openAiModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

/** Installed models on an Ollama server, or the models an OpenAI-compatible server (llama.cpp, LM Studio, vLLM) serves. */
export async function listLocalModels(
  kind: "ollama" | "openai_compatible",
  baseUrl: string,
  options: { apiKey?: string; fetcher?: FetchLike } = {}
): Promise<LocalModelListing> {
  const fetcher = options.fetcher ?? fetch;
  const source = kind === "ollama" ? ollamaTagsUrl(baseUrl) : openAiModelsUrl(baseUrl);
  const response = await fetcher(source, {
    headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : undefined,
    signal: AbortSignal.timeout(5_000)
  });

  if (!response.ok) {
    throw new Error(`${source} answered HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { data?: Array<{ id?: unknown }>; models?: Array<{ model?: unknown; name?: unknown }> };
  const names =
    kind === "ollama"
      ? (body.models ?? []).map((model) => model.name ?? model.model)
      : (body.data ?? []).map((model) => model.id);

  return {
    models: [...new Set(names.filter((name): name is string => typeof name === "string" && name.length > 0))].sort(),
    source
  };
}
