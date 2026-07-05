// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import {
  activeEmbeddingModel,
  embedTexts,
  setEmbeddingFetchForTests
} from "@/lib/embeddings";

afterEach(() => {
  delete process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_EMBEDDING_MODEL;
  process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
  setEmbeddingFetchForTests(undefined);
});

describe("embeddings", () => {
  it("uses the local hash embedding model when Voyage is not configured", async () => {
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    delete process.env.VOYAGE_API_KEY;

    const model = activeEmbeddingModel();
    const embeddings = await embedTexts(["organic bananas costco"]);

    expect(model).toEqual({
      dims: 1536,
      id: "model_local_hashing_v1",
      model: "hashing-token-v1",
      provider: "local_hash"
    });
    expect(embeddings).toHaveLength(1);
    expect(embeddings[0]).toHaveLength(1536);
  });

  it("batches Voyage embedding calls at 128 inputs", async () => {
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.VOYAGE_API_KEY = "test-voyage-key";
    const calls: Array<{ input: string[]; inputType?: string; model?: string }> = [];

    setEmbeddingFetchForTests(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string[];
        input_type?: string;
        model?: string;
      };
      const input = body.input ?? [];
      calls.push({
        input,
        inputType: body.input_type,
        model: body.model
      });

      return voyageEmbeddingResponse(input.length);
    });

    const embeddings = await embedTexts(
      Array.from({ length: 129 }, (_unused, index) => `document ${index}`),
      { inputType: "document" }
    );

    expect(embeddings).toHaveLength(129);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      inputType: "document",
      model: "voyage-4-large"
    });
    expect(calls[0]?.input).toHaveLength(128);
    expect(calls[1]?.input).toHaveLength(1);
  });

  it("retries a Voyage 429 once before succeeding", async () => {
    process.env.AI_FINANCES_IGNORE_WORKSPACE_ENV = "1";
    process.env.VOYAGE_API_KEY = "test-voyage-key";
    let callCount = 0;

    setEmbeddingFetchForTests(async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: "rate_limit",
              message: "rate limited",
              param: null,
              type: "rate_limit_error"
            }
          }),
          {
            headers: { "content-type": "application/json" },
            status: 429
          }
        );
      }

      return voyageEmbeddingResponse(1);
    });

    const embeddings = await embedTexts(["grocery query"], { inputType: "query" });

    expect(embeddings).toHaveLength(1);
    expect(callCount).toBe(2);
  });
});

function voyageEmbeddingResponse(count: number): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, (_unused, index) => ({
        embedding: Array.from({ length: 1024 }, (_dimension, dimension) => (dimension === index % 1024 ? 1 : 0))
      })),
      usage: { total_tokens: count }
    }),
    {
      headers: { "content-type": "application/json" },
      status: 200
    }
  );
}
