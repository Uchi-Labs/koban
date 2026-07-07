import { embedMany } from "ai";
import { createHash } from "node:crypto";
import { createVoyage, type VoyageEmbeddingOptions } from "voyage-ai-provider";
import { readWorkspaceEnv, type WorkspaceEnv } from "@/lib/workspace-env";

export type EmbeddingInputType = "document" | "query";

export interface EmbeddingModelInfo {
  dims: number;
  id: string;
  model: string;
  provider: "local_hash" | "voyage";
}

export class EmbeddingProviderError extends Error {
  readonly code: "configuration" | "provider_failure" | "rate_limited";

  constructor({
    cause,
    code,
    message
  }: {
    cause?: unknown;
    code: EmbeddingProviderError["code"];
    message: string;
  }) {
    super(message, { cause });
    this.name = "EmbeddingProviderError";
    this.code = code;
  }
}

const localEmbeddingDimensions = 1536;
const localEmbeddingModelId = "model_local_hashing_v1";
const localEmbeddingModelName = "hashing-token-v1";
const defaultVoyageEmbeddingModel = "voyage-4-large";
const voyageBatchSize = 128;

const voyageModelDimensions = new Map<string, number>([
  ["voyage-4-large", 1024],
  ["voyage-4", 1024],
  ["voyage-4-lite", 1024],
  ["voyage-code-3", 1024],
  ["voyage-finance-2", 1024],
  ["voyage-law-2", 1024],
  ["voyage-code-2", 1536],
  ["voyage-3-large", 1024],
  ["voyage-3.5", 1024],
  ["voyage-3.5-lite", 1024],
  ["voyage-3", 1024],
  ["voyage-3-lite", 512],
  ["voyage-multilingual-2", 1024]
]);

let voyageFetchForTests: typeof fetch | undefined;

export function activeEmbeddingModel(env: WorkspaceEnv = readWorkspaceEnv()): EmbeddingModelInfo {
  if (!env.VOYAGE_API_KEY?.trim()) {
    return {
      dims: localEmbeddingDimensions,
      id: localEmbeddingModelId,
      model: localEmbeddingModelName,
      provider: "local_hash"
    };
  }

  const model = env.VOYAGE_EMBEDDING_MODEL?.trim() || defaultVoyageEmbeddingModel;
  const dims = voyageModelDimensions.get(model);

  if (!dims) {
    throw new EmbeddingProviderError({
      code: "configuration",
      message: `VOYAGE_EMBEDDING_MODEL ${model} has unknown embedding dimensions.`
    });
  }

  return {
    dims,
    id: `model_voyage_${stableModelIdPart(model)}_${dims}`,
    model,
    provider: "voyage"
  };
}

export async function embedTexts(
  texts: string[],
  options: {
    inputType?: EmbeddingInputType;
    model?: EmbeddingModelInfo;
  } = {}
): Promise<number[][]> {
  const model = options.model ?? activeEmbeddingModel();

  if (texts.length === 0) {
    return [];
  }

  if (model.provider === "local_hash") {
    return texts.map(localHashEmbedText);
  }

  return embedTextsWithVoyage(texts, model, options.inputType ?? "document");
}

function localHashEmbedText(text: string): number[] {
  const vectorValues = new Array<number>(localEmbeddingDimensions).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    addToken(vectorValues, token, 1);
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    addToken(vectorValues, `${tokens[index]} ${tokens[index + 1]}`, 0.65);
  }

  const magnitude = Math.sqrt(vectorValues.reduce((total, value) => total + value * value, 0));

  if (magnitude === 0) {
    vectorValues[0] = 1;
    return vectorValues;
  }

  return vectorValues.map((value) => value / magnitude);
}

export function setEmbeddingFetchForTests(fetchOverride: typeof fetch | undefined): void {
  voyageFetchForTests = fetchOverride;
}

async function embedTextsWithVoyage(
  texts: string[],
  model: EmbeddingModelInfo,
  inputType: EmbeddingInputType
): Promise<number[][]> {
  const env = readWorkspaceEnv();
  const provider = createVoyage({
    apiKey: env.VOYAGE_API_KEY,
    fetch: voyageFetchForTests
  });
  const embeddingModel = provider.textEmbeddingModel(model.model);
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += voyageBatchSize) {
    const chunk = texts.slice(index, index + voyageBatchSize);
    const chunkEmbeddings = await embedVoyageChunk({ chunk, embeddingModel, inputType, model });
    embeddings.push(...chunkEmbeddings);
  }

  return embeddings;
}

async function embedVoyageChunk({
  chunk,
  embeddingModel,
  inputType,
  model
}: {
  chunk: string[];
  embeddingModel: ReturnType<ReturnType<typeof createVoyage>["textEmbeddingModel"]>;
  inputType: EmbeddingInputType;
  model: EmbeddingModelInfo;
}): Promise<number[][]> {
  try {
    return await callVoyageEmbeddingModel({ chunk, embeddingModel, inputType, model });
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw new EmbeddingProviderError({
        cause: error,
        code: "provider_failure",
        message: `Voyage embedding failed for ${model.model}.`
      });
    }

    await sleep(500);

    try {
      return await callVoyageEmbeddingModel({ chunk, embeddingModel, inputType, model });
    } catch (retryError) {
      throw new EmbeddingProviderError({
        cause: retryError,
        code: "rate_limited",
        message: `Voyage embedding was rate limited for ${model.model}.`
      });
    }
  }
}

async function callVoyageEmbeddingModel({
  chunk,
  embeddingModel,
  inputType,
  model
}: {
  chunk: string[];
  embeddingModel: ReturnType<ReturnType<typeof createVoyage>["textEmbeddingModel"]>;
  inputType: EmbeddingInputType;
  model: EmbeddingModelInfo;
}): Promise<number[][]> {
  const { embeddings } = await embedMany({
    maxParallelCalls: 1,
    maxRetries: 0,
    model: embeddingModel,
    providerOptions: {
      voyage: {
        inputType,
        outputDtype: "float"
      } satisfies VoyageEmbeddingOptions
    },
    values: chunk
  });

  for (const embedding of embeddings) {
    if (embedding.length !== model.dims) {
      throw new EmbeddingProviderError({
        code: "provider_failure",
        message: `Voyage embedding dimension mismatch for ${model.model}: expected ${model.dims}, received ${embedding.length}.`
      });
    }
  }

  return embeddings;
}

function addToken(vectorValues: number[], token: string, weight: number) {
  const hash = createHash("sha256").update(token).digest();
  const index = hash.readUInt32BE(0) % localEmbeddingDimensions;
  const sign = hash[4] % 2 === 0 ? 1 : -1;
  vectorValues[index] += sign * weight;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .slice(0, 512);
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;

  if (record.statusCode === 429 || record.status === 429) {
    return true;
  }

  return isRateLimitError(record.cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stableModelIdPart(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const stopWords = new Set([
  "and",
  "are",
  "at",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);
