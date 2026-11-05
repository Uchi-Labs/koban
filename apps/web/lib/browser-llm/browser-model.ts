"use client";

// The Ask model in the browser: LFM3-1.7B on WebGPU through Transformers.js,
// in a module worker so loading and generation never block the page (the same
// pattern as on-device dictation, lib/dictation.ts). Unlike dictation there is
// no WebAssembly fallback: a 1.7B model on the CPU is too slow to answer, so
// readiness says unsupported instead. Transformers.js keeps the downloaded
// files in Cache Storage, so only the first load fetches them.

import type { BrowserGenerate, BrowserGenerateInput } from "./agent-loop";
import { browserModelId, type BrowserModelDtype } from "./settings";

// The model card asks for Transformers.js 4.3.2 or later.
const transformersUrl = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";

/** Transformers.js's Cache Storage bucket. */
export const transformersCacheName = "transformers-cache";

export type BrowserModelProgress = { loadedBytes: number; totalBytes: number };

type WorkerReply =
  | { file: string; loaded: number; total: number; type: "progress" }
  | { type: "ready" }
  | { id: number; text: string; type: "token" }
  | { id: number; outputTokens: number; promptTokens: number; text: string; type: "result" }
  | { id?: number; message: string; type: "error" };

/** Prompt tokens per prefill pass; see prefill() in the worker. */
export const prefillChunkTokens = 2048;

// Sampling from the model card (temperature 0.1, top_k 50, repetition penalty
// 1.1) with thinking left on, as the server sets it for LFM models.
const workerSource = `
import { AutoModelForCausalLM, AutoTokenizer, InterruptableStoppingCriteria, TextStreamer } from "${transformersUrl}";
let loaded = null;
const stopping = new InterruptableStoppingCriteria();
function load(dtype) {
  loaded ??= (async () => {
    const progress_callback = (event) => {
      if (event.status === "progress") {
        self.postMessage({ type: "progress", file: event.file, loaded: event.loaded ?? 0, total: event.total ?? 0 });
      }
    };
    const tokenizer = await AutoTokenizer.from_pretrained("${browserModelId}", { progress_callback });
    const model = await AutoModelForCausalLM.from_pretrained("${browserModelId}", { device: "webgpu", dtype, progress_callback });
    return { model, tokenizer };
  })();
  loaded.catch(() => { loaded = null; });
  return loaded;
}
const prefillChunkTokens = ${prefillChunkTokens};
async function prefill(model, inputs, promptTokens) {
  let past_key_values = null;
  for (let end = prefillChunkTokens; end < promptTokens; end += prefillChunkTokens) {
    const chunk = await model.generate({
      attention_mask: inputs.attention_mask.slice(null, [0, end]),
      do_sample: false,
      input_ids: inputs.input_ids.slice(null, [0, end]),
      max_new_tokens: 1,
      past_key_values,
      return_dict_in_generate: true
    });
    past_key_values = chunk.past_key_values;
  }
  return past_key_values;
}
self.onmessage = async (event) => {
  const { dtype, id, maxNewTokens, messages, tools, type } = event.data;
  if (type === "abort") {
    stopping.interrupt();
    return;
  }
  try {
    const { model, tokenizer } = await load(dtype);
    if (type === "load") {
      self.postMessage({ type: "ready" });
      return;
    }
    const inputs = tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      enable_thinking: true,
      return_dict: true,
      tools
    });
    let text = "";
    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (piece) => {
        text += piece;
        self.postMessage({ id, text: piece, type: "token" });
      }
    });
    stopping.reset();
    const promptTokens = inputs.input_ids.dims.at(-1);
    // Prefill the prompt a chunk at a time. One pass over ~10k tokens ran past
    // the GPU driver's job timeout (amdgpu reset the ring; Windows TDR allows
    // 2 s), which loses the WebGPU device. Each chunk extends the same cache.
    const past_key_values = await prefill(model, inputs, promptTokens);
    let cache = past_key_values;
    try {
      const output = await model.generate({
        ...inputs,
        do_sample: true,
        max_new_tokens: maxNewTokens,
        past_key_values,
        repetition_penalty: 1.1,
        return_dict_in_generate: true,
        stopping_criteria: stopping,
        streamer,
        temperature: 0.1,
        top_k: 50
      });
      cache = output.past_key_values;
      self.postMessage({ id, outputTokens: output.sequences.dims.at(-1) - promptTokens, promptTokens, text, type: "result" });
    } finally {
      await cache?.dispose?.();
    }
  } catch (error) {
    self.postMessage({ id, message: error instanceof Error ? error.message : String(error), type: "error" });
  }
};
`;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let readyDtype: BrowserModelDtype | null = null;
let nextId = 0;
const progressListeners = new Set<(progress: BrowserModelProgress) => void>();
const fileProgress = new Map<string, { loaded: number; total: number }>();

function getWorker(): Worker {
  if (worker) return worker;
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  worker = new Worker(url, { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    if (event.data.type !== "progress") return;
    fileProgress.set(event.data.file, { loaded: event.data.loaded, total: event.data.total });
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const file of fileProgress.values()) {
      loadedBytes += file.loaded;
      totalBytes += file.total;
    }
    for (const listener of progressListeners) listener({ loadedBytes, totalBytes });
  });
  return worker;
}

/** Downloads (first time) and compiles the model on the GPU; safe to call repeatedly. */
export function loadBrowserModel(dtype: BrowserModelDtype, onProgress?: (progress: BrowserModelProgress) => void): Promise<void> {
  if (onProgress) progressListeners.add(onProgress);

  if (ready && readyDtype !== dtype) {
    disposeBrowserModel();
  }

  readyDtype = dtype;
  ready ??= new Promise<void>((resolve, reject) => {
    const target = getWorker();
    const onMessage = (event: MessageEvent<WorkerReply>) => {
      if (event.data.type === "ready") {
        target.removeEventListener("message", onMessage);
        resolve();
      } else if (event.data.type === "error" && event.data.id === undefined) {
        target.removeEventListener("message", onMessage);
        ready = null;
        reject(new Error(event.data.message));
      }
    };
    target.addEventListener("message", onMessage);
    target.postMessage({ dtype, type: "load" });
  });

  return ready.finally(() => {
    if (onProgress) progressListeners.delete(onProgress);
  });
}

/** Stops the worker and frees the GPU memory the model holds. */
export function disposeBrowserModel() {
  worker?.terminate();
  worker = null;
  ready = null;
  readyDtype = null;
  fileProgress.clear();
}

/** A `BrowserGenerate` backed by the worker, loading the model first if it is not loaded. */
export function createWorkerGenerate(dtype: BrowserModelDtype, onProgress?: (progress: BrowserModelProgress) => void): BrowserGenerate {
  return async ({ maxNewTokens, messages, onText, signal, tools }: BrowserGenerateInput) => {
    await loadBrowserModel(dtype, onProgress);
    const id = ++nextId;
    const target = getWorker();
    const startedAt = performance.now();

    return new Promise<string>((resolve, reject) => {
      const onAbort = () => target.postMessage({ id, type: "abort" });
      const onMessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data;
        if (!("id" in reply) || reply.id !== id) return;
        if (reply.type === "token") {
          onText(reply.text);
          return;
        }
        target.removeEventListener("message", onMessage);
        signal?.removeEventListener("abort", onAbort);
        if (reply.type === "result") {
          // Shows each step's token counts and time in the browser's performance timeline.
          performance.measure("koban-browser-model-step", {
            detail: { outputTokens: reply.outputTokens, promptTokens: reply.promptTokens },
            end: performance.now(),
            start: startedAt
          });
          resolve(reply.text);
        }
        else if (reply.type === "error") {
          // A lost GPU device leaves the loaded model unusable; the next question loads it again.
          if (/device.*lost|is lost/i.test(reply.message)) disposeBrowserModel();
          reject(new Error(reply.message));
        }
      };
      target.addEventListener("message", onMessage);
      signal?.addEventListener("abort", onAbort, { once: true });
      target.postMessage({ id, maxNewTokens, messages, tools, type: "generate" });
    });
  };
}

/** True when this browser already holds the model's weights for the dtype, so turning it on downloads nothing. */
export async function isBrowserModelCached(dtype: BrowserModelDtype): Promise<boolean> {
  if (typeof caches === "undefined") return false;

  try {
    const cache = await caches.open(transformersCacheName);
    const keys = await cache.keys();
    return keys.some((request) => request.url.includes(browserModelId) && request.url.endsWith(`/onnx/model_${dtype}.onnx_data`));
  } catch {
    return false;
  }
}
