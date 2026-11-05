import type { BrowserModelDtype } from "./settings";

// The parts of WebGPU this check reads; the DOM library has no WebGPU types.
interface GpuAdapterLike {
  features?: { has(feature: string): boolean };
  info?: { architecture?: string; description?: string; isFallbackAdapter?: boolean; vendor?: string };
  isFallbackAdapter?: boolean;
}

export interface NavigatorLike {
  deviceMemory?: number;
  gpu?: { requestAdapter(options?: { powerPreference?: "high-performance" | "low-power" }): Promise<GpuAdapterLike | null> };
}

export type BrowserModelReadiness =
  | { adapter: string; dtype: BrowserModelDtype; status: "ready" }
  | { reason: string; status: "unsupported" };

/** Chrome reports device memory rounded down and capped, so 4 GB means "at least 4". */
export const browserModelMinDeviceMemoryGb = 4;

/**
 * Whether this browser can run the model on a real GPU. No WebGPU, only a
 * software adapter (SwiftShader), or too little memory each answer
 * "unsupported" with the reason; there is no CPU fallback for a model this size.
 */
export async function detectBrowserModelSupport(
  nav: NavigatorLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike),
  hasWorker = typeof Worker !== "undefined"
): Promise<BrowserModelReadiness> {
  if (!nav || !hasWorker) {
    return { reason: "This browser cannot run background workers.", status: "unsupported" };
  }

  if (!nav.gpu) {
    return {
      reason: "This browser has no WebGPU. Use a recent Chrome, Edge or Safari over HTTPS or localhost.",
      status: "unsupported"
    };
  }

  let adapter: GpuAdapterLike | null = null;

  try {
    adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    adapter = null;
  }

  if (!adapter) {
    return { reason: "WebGPU found no GPU on this device.", status: "unsupported" };
  }

  if (adapter.info?.isFallbackAdapter || adapter.isFallbackAdapter) {
    return {
      reason: "WebGPU only offers a software renderer here, too slow for a 1.7B model. Turn on hardware acceleration in the browser.",
      status: "unsupported"
    };
  }

  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < browserModelMinDeviceMemoryGb) {
    return {
      reason: `This device reports ${nav.deviceMemory} GB of memory; the model needs at least ${browserModelMinDeviceMemoryGb} GB.`,
      status: "unsupported"
    };
  }

  const name = [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(" ") || "GPU";
  return {
    adapter: name,
    dtype: adapter.features?.has("shader-f16") ? "q4f16" : "q4",
    status: "ready"
  };
}
