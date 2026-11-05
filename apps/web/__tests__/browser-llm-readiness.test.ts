import { describe, expect, it } from "vitest";
import { detectBrowserModelSupport, type NavigatorLike } from "@/lib/browser-llm/readiness";
import {
  browserModelDownloadBytes,
  browserModelStorageKey,
  formatDownloadSize,
  readBrowserModelSettings,
  writeBrowserModelSettings
} from "@/lib/browser-llm/settings";

const gpu = (adapter: unknown): NavigatorLike["gpu"] => ({ requestAdapter: async () => adapter as never });
const amd = (features: string[] = ["shader-f16"], info: Record<string, unknown> = {}) => ({
  features: new Set(features),
  info: { architecture: "rdna-4", vendor: "amd", ...info }
});

describe("detectBrowserModelSupport", () => {
  it("is ready on a hardware adapter, with q4f16 when the GPU has shader-f16", async () => {
    await expect(detectBrowserModelSupport({ deviceMemory: 32, gpu: gpu(amd()) }, true)).resolves.toEqual({
      adapter: "amd rdna-4",
      dtype: "q4f16",
      status: "ready"
    });
    await expect(detectBrowserModelSupport({ gpu: gpu(amd([])) }, true)).resolves.toMatchObject({ dtype: "q4", status: "ready" });
  });

  it("says why when there is no WebGPU, no adapter, or a failing adapter request", async () => {
    await expect(detectBrowserModelSupport({}, true)).resolves.toMatchObject({
      reason: expect.stringContaining("no WebGPU"),
      status: "unsupported"
    });
    await expect(detectBrowserModelSupport({ gpu: gpu(null) }, true)).resolves.toEqual({
      reason: "WebGPU found no GPU on this device.",
      status: "unsupported"
    });
    const throwing: NavigatorLike = { gpu: { requestAdapter: async () => Promise.reject(new Error("blocked")) } };
    await expect(detectBrowserModelSupport(throwing, true)).resolves.toMatchObject({ status: "unsupported" });
  });

  it("refuses a software (fallback) adapter such as SwiftShader", async () => {
    const swiftShader = amd([], { architecture: "swiftshader", isFallbackAdapter: true, vendor: "google" });

    await expect(detectBrowserModelSupport({ gpu: gpu(swiftShader) }, true)).resolves.toMatchObject({
      reason: expect.stringContaining("software renderer"),
      status: "unsupported"
    });
  });

  it("refuses a device that reports less than 4 GB of memory, and one without workers", async () => {
    await expect(detectBrowserModelSupport({ deviceMemory: 2, gpu: gpu(amd()) }, true)).resolves.toEqual({
      reason: "This device reports 2 GB of memory; the model needs at least 4 GB.",
      status: "unsupported"
    });
    await expect(detectBrowserModelSupport({ gpu: gpu(amd()) }, false)).resolves.toMatchObject({ status: "unsupported" });
  });
});

describe("browser model settings", () => {
  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => void values.delete(key),
      setItem: (key: string, value: string) => void values.set(key, value),
      values
    };
  }

  it("is off until turned on, and turning it off forgets it", () => {
    const storage = memoryStorage();
    expect(readBrowserModelSettings(storage)).toEqual({ enabled: false });

    writeBrowserModelSettings({ enabled: true }, storage);
    expect(readBrowserModelSettings(storage)).toEqual({ enabled: true });

    writeBrowserModelSettings({ enabled: false }, storage);
    expect(storage.values.has(browserModelStorageKey)).toBe(false);
  });

  it("reads a malformed or foreign value as off", () => {
    const storage = memoryStorage();
    storage.setItem(browserModelStorageKey, "{not json");
    expect(readBrowserModelSettings(storage)).toEqual({ enabled: false });
    storage.setItem(browserModelStorageKey, JSON.stringify({ enabled: "yes" }));
    expect(readBrowserModelSettings(storage)).toEqual({ enabled: false });
    expect(readBrowserModelSettings(null)).toEqual({ enabled: false });
  });

  it("labels the download with its measured size", () => {
    expect(formatDownloadSize(browserModelDownloadBytes.q4f16)).toBe("1.1 GB");
    expect(formatDownloadSize(browserModelDownloadBytes.q4)).toBe("1.3 GB");
    expect(formatDownloadSize(17_908_635)).toBe("18 MB");
  });
});
