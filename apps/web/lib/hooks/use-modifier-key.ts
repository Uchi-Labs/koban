"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function isApplePlatform(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * The modifier to show in shortcut hints: "⌘" on Apple platforms, "Ctrl"
 * elsewhere. Handlers already accept either key; this only fixes the label.
 * The server renders "⌘" and the client corrects it after hydration.
 */
export function useModifierKeyLabel(): "⌘" | "Ctrl" {
  return useSyncExternalStore(
    subscribe,
    () => (isApplePlatform() ? "⌘" : "Ctrl"),
    () => "⌘"
  );
}
