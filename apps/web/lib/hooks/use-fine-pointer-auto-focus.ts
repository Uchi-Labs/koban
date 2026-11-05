"use client";

import { useCallback } from "react";

/**
 * A ref that focuses its element on mount, but only with a mouse or trackpad.
 * On touch screens autofocus pops the keyboard before the user has read the
 * screen. Done after mount rather than through `autoFocus`, which the server
 * renders as an attribute and would then disagree with the client.
 */
export function useFinePointerAutoFocus<T extends HTMLElement>() {
  return useCallback((node: T | null) => {
    if (node && window.matchMedia("(pointer: fine)").matches) {
      node.focus();
    }
  }, []);
}
