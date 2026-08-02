// Haptic layer paired to the sound palette.
//
// Adapted from Amicro's `use-web-haptics` (https://amicro.vercel.app). Two changes
// from their version: it's a module rather than a hook, because `lib/ui-sound.ts` is
// the single funnel every UI voice already flows through — so pairing here gives every
// existing call site haptics for free. And their six generic levels
// (light/medium/heavy/success/warning/error) are re-mapped onto this app's sixteen
// named voices, so a `copy` buzzes differently from an `error`.
//
// Rules: never throw (haptics are ornamental, like audio), respect
// prefers-reduced-motion, and carry an independent mute from sound — a phone on a desk
// wants buzz without noise, a laptop in a meeting wants the reverse.

import type { UiSoundName } from "@/lib/ui-sound";

const HAPTICS_MUTED_STORAGE_KEY = "ai-finances:ui-haptics-muted";
const HAPTICS_MUTED_CHANGE_EVENT = "ai-finances:ui-haptics-muted-change";

// Durations in ms; arrays are vibrate/pause/vibrate patterns.
// Kept deliberately short — anything past ~60ms on a single pulse reads as a buzz
// rather than a tap, and money software should feel precise, not noisy.
const HAPTIC_PATTERNS: Record<UiSoundName, number | number[]> = {
  close: 12,
  collapse: 10,
  copy: [8, 40, 8],
  error: [40, 50, 40],
  expand: 14,
  hover: 5,
  open: 14,
  select: 12,
  send: [10, 30, 18],
  success: [12, 45, 12],
  sync: [8, 60, 8, 60, 8],
  tabSwitch: 8,
  tap: 8,
  toast: 15,
  toggleOff: 8,
  toggleOn: 12
};

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function canVibrate(): boolean {
  return hasWindow() && typeof window.navigator?.vibrate === "function";
}

function prefersReducedMotion(): boolean {
  if (!hasWindow() || typeof window.matchMedia !== "function") {
    return false;
  }

  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function isUiHapticsMuted(): boolean {
  if (!hasWindow()) {
    return false;
  }

  try {
    return window.localStorage.getItem(HAPTICS_MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setUiHapticsMuted(muted: boolean) {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.setItem(HAPTICS_MUTED_STORAGE_KEY, String(muted));
    window.dispatchEvent(new Event(HAPTICS_MUTED_CHANGE_EVENT));
  } catch {
    // Private browsing can reject localStorage writes; the toggle just won't persist.
  }
}

export function isUiHapticsEnabled(): boolean {
  return !isUiHapticsMuted();
}

export function subscribeUiHapticsMuted(listener: () => void) {
  if (!hasWindow()) {
    return () => undefined;
  }

  window.addEventListener(HAPTICS_MUTED_CHANGE_EVENT, listener);
  return () => window.removeEventListener(HAPTICS_MUTED_CHANGE_EVENT, listener);
}

/** Fire the haptic paired to a UI sound voice. Safe to call anywhere, always. */
export function triggerUiHaptic(name: UiSoundName) {
  if (!canVibrate() || isUiHapticsMuted() || prefersReducedMotion()) {
    return;
  }

  try {
    window.navigator.vibrate(HAPTIC_PATTERNS[name] ?? 8);
  } catch {
    // Vibration is ornamental. A blocked or unsupported API must never affect app flows.
  }
}
