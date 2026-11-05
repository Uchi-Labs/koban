"use client";

/**
 * Whether to autofocus a field on mount. On touch screens autofocus pops the
 * software keyboard before the user has read the screen, so it is mouse and
 * trackpad only. Read at render; React applies autoFocus on mount, not as an
 * SSR attribute, so server and client can disagree without a mismatch.
 */
export function shouldAutoFocus(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}
