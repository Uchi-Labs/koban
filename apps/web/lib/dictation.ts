"use client";

// On-device dictation: Moonshine (English speech-to-text) running on WebGPU
// through Transformers.js, inside a module worker so model compile and decode
// never block the page. Devices without a WebGPU adapter run the same model on
// the CPU through WebAssembly: slower, but still private and still working. Nothing leaves the browser except the one-time model
// download from Hugging Face, which the browser caches. The library loads from
// the CDN on first use, so it adds nothing to the app bundle.

const transformersUrl = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm";
const modelId = "onnx-community/moonshine-base-ONNX";
const sampleRate = 16_000;

export type DictationProgress = { loadedBytes: number; totalBytes: number };

type WorkerReply =
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "ready" }
  | { id: number; text: string; type: "result" }
  | { id?: number; message: string; type: "error" };

const workerSource = `
import { pipeline } from "${transformersUrl}";
let transcriberPromise = null;
async function pickDevice() {
  try {
    return (await navigator.gpu?.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}
function load() {
  transcriberPromise ??= pickDevice().then((device) => pipeline("automatic-speech-recognition", "${modelId}", {
    device,
    dtype: { encoder_model: "q4", decoder_model_merged: "q4" },
    progress_callback: (event) => {
      if (event.status === "progress") {
        self.postMessage({ type: "progress", file: event.file, loaded: event.loaded ?? 0, total: event.total ?? 0 });
      }
    }
  }));
  return transcriberPromise;
}
self.onmessage = async (event) => {
  const { audio, id, type } = event.data;
  try {
    const transcriber = await load();
    if (type === "load") {
      self.postMessage({ type: "ready" });
      return;
    }
    const output = await transcriber(audio);
    self.postMessage({ id, text: String(output.text ?? "").trim(), type: "result" });
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({ id, message: error instanceof Error ? error.message : String(error), type: "error" });
  }
};
`;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 0;
const progressListeners = new Set<(progress: DictationProgress) => void>();
const fileProgress = new Map<string, { loaded: number; total: number }>();

export function isDictationSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof Worker !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

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

/** Downloads (first time) and compiles the model; safe to call repeatedly. */
export function loadDictationModel(onProgress?: (progress: DictationProgress) => void): Promise<void> {
  if (onProgress) progressListeners.add(onProgress);
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
    target.postMessage({ type: "load" });
  });
  return ready.finally(() => {
    if (onProgress) progressListeners.delete(onProgress);
  });
}

export async function transcribeRecording(recording: Blob): Promise<string> {
  const audio = await decodeToMono16k(recording);
  await loadDictationModel();
  const id = ++nextId;
  const target = getWorker();
  return new Promise<string>((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if ((reply.type === "result" || reply.type === "error") && reply.id === id) {
        target.removeEventListener("message", onMessage);
        if (reply.type === "result") resolve(reply.text);
        else reject(new Error(reply.message));
      }
    };
    target.addEventListener("message", onMessage);
    target.postMessage({ audio, id, type: "transcribe" }, [audio.buffer]);
  });
}

async function decodeToMono16k(recording: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate });
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    return new Float32Array(decoded.getChannelData(0));
  } finally {
    void context.close();
  }
}
