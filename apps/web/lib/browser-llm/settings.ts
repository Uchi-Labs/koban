// The in-browser model is a choice about this browser, not the workspace: it
// is saved in localStorage, so another device (or a public-demo visitor) starts
// with it off and never downloads it unless someone turns it on there.

export const browserModelId = "onnx-community/LFM3-1.7B-ONNX";
export const browserModelLabel = "LFM3 1.7B";

/** q4f16 needs the GPU's shader-f16 feature; q4 runs on any WebGPU adapter. */
export type BrowserModelDtype = "q4" | "q4f16";

/**
 * Bytes fetched on first use, summed from the Hugging Face file listing on
 * 2026-11-05: the ONNX graph and weights for the dtype, plus tokenizer.json
 * (17.9 MB), tokenizer_config.json, chat_template.jinja, config.json and
 * generation_config.json (28 KB together).
 */
export const browserModelDownloadBytes: Record<BrowserModelDtype, number> = {
  q4: 301_147 + 1_297_248_256 + 17_908_635 + 28_181,
  q4f16: 296_714 + 1_087_789_056 + 17_908_635 + 28_181
};

export const browserModelStorageKey = "koban.browser-model.v1";

export interface BrowserModelSettings {
  enabled: boolean;
}

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readBrowserModelSettings(storage: StorageLike | null = defaultStorage()): BrowserModelSettings {
  try {
    const parsed = JSON.parse(storage?.getItem(browserModelStorageKey) ?? "null") as Partial<BrowserModelSettings> | null;
    return { enabled: parsed?.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function writeBrowserModelSettings(settings: BrowserModelSettings, storage: StorageLike | null = defaultStorage()) {
  if (!storage) return;

  if (settings.enabled) {
    storage.setItem(browserModelStorageKey, JSON.stringify(settings));
  } else {
    storage.removeItem(browserModelStorageKey);
  }
}

export function formatDownloadSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
