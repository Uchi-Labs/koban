"use client";

import {
  defineSequence,
  defineSound,
  ensureReady,
  setMasterVolume,
  type PlayOptions,
  type SoundDefinition,
} from "@web-kits/audio";

const UI_SOUND_MUTED_STORAGE_KEY = "ai-finances:ui-sound-muted";

const SOUND_MUTED_CHANGE_EVENT = "ai-finances:ui-sound-muted-change";
const MASTER_VOLUME = 0.72;

export const UI_SOUND_NAMES = [
  "tap",
  "select",
  "toggleOn",
  "toggleOff",
  "success",
  "error",
  "toast",
  "open",
  "close",
  "sync",
] as const;

export type UiSoundName = (typeof UI_SOUND_NAMES)[number];

type UiSoundOverride = UiSoundName | "none";

const validSoundNames = new Set<string>(UI_SOUND_NAMES);

// Generic press/nav: a soft, filtered triangle tick with a fast decay.
const tapDefinition = {
  source: { type: "triangle", frequency: { start: 920, end: 760 } },
  filter: { type: "lowpass", frequency: 1650, resonance: 0.45 },
  envelope: { attack: 0.001, decay: 0.042, sustain: 0, release: 0.012 },
  gain: 0.12,
} satisfies SoundDefinition;

// Row/item selection: same triangle voice as tap, but brighter with a small pitch lift.
const selectDefinition = {
  source: { type: "triangle", frequency: { start: 980, end: 1240 } },
  filter: { type: "lowpass", frequency: 2350, resonance: 0.55 },
  envelope: { attack: 0.001, decay: 0.055, sustain: 0, release: 0.012 },
  gain: 0.12,
} satisfies SoundDefinition;

// State on: a rising minor third so the enabled state is hearable.
const toggleOnDefinition = {
  layers: [
    {
      source: { type: "triangle", frequency: { start: 520, end: 624 } },
      filter: { type: "lowpass", frequency: 1500, resonance: 0.5 },
      envelope: { attack: 0.001, decay: 0.068, sustain: 0, release: 0.014 },
      gain: 0.12,
    },
    {
      source: { type: "sine", frequency: 1248 },
      delay: 0.018,
      filter: { type: "lowpass", frequency: 2100, resonance: 0.4 },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 },
      gain: 0.035,
    },
  ],
} satisfies SoundDefinition;

// State off: the inverse minor third in the same voice, slightly darker.
const toggleOffDefinition = {
  layers: [
    {
      source: { type: "triangle", frequency: { start: 624, end: 520 } },
      filter: { type: "lowpass", frequency: 1250, resonance: 0.5 },
      envelope: { attack: 0.001, decay: 0.072, sustain: 0, release: 0.014 },
      gain: 0.105,
    },
    {
      source: { type: "sine", frequency: 1040 },
      delay: 0.018,
      filter: { type: "lowpass", frequency: 1600, resonance: 0.35 },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 },
      gain: 0.028,
    },
  ],
} satisfies SoundDefinition;

// Completion: two-note micro-chime, major second into a soft major third color.
const successDefinition = {
  layers: [
    {
      source: { type: "triangle", frequency: 740 },
      filter: { type: "lowpass", frequency: 2600, resonance: 0.45 },
      envelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.018 },
      gain: 0.115,
      pan: -0.04,
    },
    {
      source: { type: "triangle", frequency: 932 },
      delay: 0.055,
      filter: { type: "lowpass", frequency: 3000, resonance: 0.45 },
      envelope: { attack: 0.002, decay: 0.076, sustain: 0, release: 0.018 },
      gain: 0.1,
      pan: 0.04,
    },
  ],
} satisfies SoundDefinition;

// Error: low filtered thud plus a short brown-noise tail; felt, not alarming.
const errorDefinition = {
  layers: [
    {
      source: { type: "triangle", frequency: { start: 210, end: 128 } },
      filter: { type: "lowpass", frequency: 430, resonance: 0.7 },
      envelope: { attack: 0.001, decay: 0.105, sustain: 0, release: 0.018 },
      gain: 0.155,
    },
    {
      source: { type: "noise", color: "brown" },
      delay: 0.034,
      filter: [
        { type: "highpass", frequency: 95, resonance: 0.3 },
        { type: "bandpass", frequency: 360, resonance: 0.8 },
      ],
      envelope: { attack: 0.001, decay: 0.065, sustain: 0, release: 0.012 },
      gain: 0.06,
    },
  ],
} satisfies SoundDefinition;

// Toast arrival: a tiny filtered-noise pop with a low triangle body.
const toastDefinition = {
  layers: [
    {
      source: { type: "noise", color: "pink" },
      filter: { type: "bandpass", frequency: 1650, resonance: 1.2 },
      envelope: { attack: 0.001, decay: 0.038, sustain: 0, release: 0.01 },
      gain: 0.075,
    },
    {
      source: { type: "triangle", frequency: { start: 760, end: 620 } },
      filter: { type: "lowpass", frequency: 1400, resonance: 0.4 },
      envelope: { attack: 0.001, decay: 0.052, sustain: 0, release: 0.01 },
      gain: 0.055,
    },
  ],
} satisfies SoundDefinition;

// Surface open: airy two-band pink-noise whoosh moving upward.
const openDefinition = {
  layers: [
    {
      source: { type: "noise", color: "pink" },
      filter: { type: "bandpass", frequency: 760, resonance: 0.95 },
      envelope: { attack: 0.004, decay: 0.072, sustain: 0, release: 0.018 },
      gain: 0.055,
      pan: -0.05,
    },
    {
      source: { type: "noise", color: "pink" },
      delay: 0.05,
      filter: { type: "bandpass", frequency: 2100, resonance: 1.05 },
      envelope: { attack: 0.004, decay: 0.08, sustain: 0, release: 0.018 },
      gain: 0.07,
      pan: 0.05,
    },
  ],
} satisfies SoundDefinition;

// Surface close: the inverse downward whoosh, darker at the tail.
const closeDefinition = {
  layers: [
    {
      source: { type: "noise", color: "pink" },
      filter: { type: "bandpass", frequency: 2100, resonance: 1.05 },
      envelope: { attack: 0.003, decay: 0.066, sustain: 0, release: 0.016 },
      gain: 0.062,
      pan: 0.05,
    },
    {
      source: { type: "noise", color: "pink" },
      delay: 0.045,
      filter: { type: "bandpass", frequency: 720, resonance: 0.95 },
      envelope: { attack: 0.003, decay: 0.078, sustain: 0, release: 0.016 },
      gain: 0.065,
      pan: -0.05,
    },
  ],
} satisfies SoundDefinition;

// Sync kickoff: subtle two-step ascending sequence, distinct from success.
const syncStepA = {
  source: { type: "triangle", frequency: 560 },
  filter: { type: "lowpass", frequency: 1450, resonance: 0.45 },
  envelope: { attack: 0.001, decay: 0.055, sustain: 0, release: 0.012 },
  gain: 0.09,
} satisfies SoundDefinition;

const syncStepB = {
  source: { type: "triangle", frequency: 705 },
  filter: { type: "lowpass", frequency: 1750, resonance: 0.45 },
  envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.012 },
  gain: 0.095,
} satisfies SoundDefinition;

const soundPlayers = {
  close: defineSound(closeDefinition),
  error: defineSound(errorDefinition),
  open: defineSound(openDefinition),
  select: defineSound(selectDefinition),
  success: defineSound(successDefinition),
  sync: defineSequence([
    { sound: syncStepA, at: 0 },
    { sound: syncStepB, at: 0.07 },
  ]),
  tap: defineSound(tapDefinition),
  toast: defineSound(toastDefinition),
  toggleOff: defineSound(toggleOffDefinition),
  toggleOn: defineSound(toggleOnDefinition),
} satisfies Record<UiSoundName, (opts?: PlayOptions) => unknown>;

let userGestureSeen = false;
let readyPromise: Promise<boolean> | null = null;

function hasWindow() {
  return typeof window !== "undefined";
}

function hasAudioContext() {
  return typeof AudioContext !== "undefined";
}

function canAttemptAudio() {
  return hasWindow() && hasAudioContext() && !isUiSoundMuted();
}

function beginUiSoundGesture() {
  userGestureSeen = true;

  if (!canAttemptAudio()) {
    return;
  }

  readyPromise ??= ensureReady({ latencyHint: "interactive" })
    .then(() => {
      setMasterVolume(MASTER_VOLUME);
      return true;
    })
    .catch(() => {
      readyPromise = null;
      return false;
    });
}

export function prepareUiSound() {
  beginUiSoundGesture();
}

function playUiSound(name: UiSoundName, opts?: PlayOptions) {
  if (!userGestureSeen || !canAttemptAudio()) {
    return;
  }

  beginUiSoundGesture();
  void readyPromise?.then((ready) => {
    if (!ready || isUiSoundMuted()) {
      return;
    }

    try {
      soundPlayers[name](opts);
    } catch {
      // Audio is ornamental. A missing/blocked AudioContext must never affect app flows.
    }
  });
}

export function playTap() {
  playUiSound("tap");
}

export function playNav() {
  playTap();
}

export function playSelect() {
  playUiSound("select");
}

export function playToggleOn() {
  playUiSound("toggleOn");
}

export function playToggleOff() {
  playUiSound("toggleOff");
}

export function playToggle(checked: boolean) {
  if (checked) {
    playToggleOn();
  } else {
    playToggleOff();
  }
}

export function playSuccess() {
  playUiSound("success");
}

export function playError() {
  playUiSound("error");
}

export function playToast() {
  playUiSound("toast");
}

export function playOpen() {
  playUiSound("open");
}

export function playClose() {
  playUiSound("close");
}

export function playSync() {
  playUiSound("sync");
}

export function isUiSoundMuted(): boolean {
  if (!hasWindow()) {
    return false;
  }

  try {
    return window.localStorage.getItem(UI_SOUND_MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setUiSoundMuted(muted: boolean) {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.setItem(UI_SOUND_MUTED_STORAGE_KEY, String(muted));
  } catch {
    return;
  }

  window.dispatchEvent(new Event(SOUND_MUTED_CHANGE_EVENT));
}

export function isUiSoundEnabled() {
  return !isUiSoundMuted();
}

export function subscribeUiSoundMuted(listener: () => void) {
  if (!hasWindow()) {
    return () => undefined;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === UI_SOUND_MUTED_STORAGE_KEY) {
      listener();
    }
  };

  window.addEventListener(SOUND_MUTED_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(SOUND_MUTED_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Global press sounds via event delegation. Specific controls can opt into a
 * semantic patch with `data-sound`, or opt out with `data-sound="none"`.
 */
export function attachGlobalUiSounds(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    beginUiSoundGesture();
    const target = event.target as HTMLElement | null;
    const soundName = target ? resolveSoundForElement(target) : undefined;

    if (soundName) {
      playUiSound(soundName);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isUiActivationKey(event)) {
      return;
    }

    beginUiSoundGesture();
    const target = event.target as HTMLElement | null;
    const soundName = target ? resolveSoundForElement(target) : undefined;

    if (soundName) {
      playUiSound(soundName);
    }
  };

  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("keydown", onKeyDown, { capture: true });

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}

function isUiActivationKey(event: KeyboardEvent) {
  return event.key === "Enter" || event.key === " ";
}

function resolveSoundForElement(target: HTMLElement): UiSoundName | undefined {
  const overrideElement = target.closest<HTMLElement>("[data-sound]");
  const override = overrideElement?.dataset.sound as UiSoundOverride | undefined;

  if (override === "none") {
    return undefined;
  }

  if (override && validSoundNames.has(override)) {
    return override;
  }

  const interactive = target.closest<HTMLElement>(
    [
      "button",
      "[role='button']",
      "a[href]",
      "[role='tab']",
      "[role='option']",
      "[role='menuitem']",
      "input[type='checkbox']",
      "[role='checkbox']",
      "[role='switch']",
      "[data-slot='checkbox']",
      "[data-slot='switch']",
      "[data-slot='select-trigger']",
      "[data-slot='select-item']",
      "[data-slot='tabs-trigger']",
      "[data-slot='dialog-trigger']",
      "[data-slot='sheet-trigger']",
      "[data-slot='dialog-close']",
      "[data-slot='sheet-close']",
      "[data-slot='collapsible-trigger']",
      "[data-slot='command-item']",
    ].join(",")
  );

  if (!interactive || isDisabled(interactive)) {
    return undefined;
  }

  if (matchesToggleControl(interactive)) {
    return willBeChecked(interactive) ? "toggleOn" : "toggleOff";
  }

  if (interactive.matches("[data-slot='dialog-close'], [data-slot='sheet-close']")) {
    return "close";
  }

  if (interactive.matches("[data-slot='dialog-trigger'], [data-slot='sheet-trigger']")) {
    return "open";
  }

  if (interactive.matches("[data-slot='collapsible-trigger']")) {
    return isExpanded(interactive) ? "close" : "open";
  }

  if (
    interactive.matches(
      "[role='option'], [role='menuitem'], [role='tab'], [data-slot='select-item'], [data-slot='tabs-trigger'], [data-slot='command-item']"
    )
  ) {
    return "select";
  }

  return "tap";
}

function isDisabled(element: HTMLElement) {
  return (
    element.ariaDisabled === "true" ||
    element.getAttribute("data-disabled") === "true" ||
    element.hasAttribute("disabled") ||
    (element as HTMLButtonElement).disabled
  );
}

function matchesToggleControl(element: HTMLElement) {
  return element.matches(
    "input[type='checkbox'], [role='checkbox'], [role='switch'], [data-slot='checkbox'], [data-slot='switch']"
  );
}

function willBeChecked(element: HTMLElement) {
  if (element instanceof HTMLInputElement && element.type === "checkbox") {
    return !element.checked;
  }

  const checked =
    element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("data-checked") !== null ||
    element.getAttribute("data-state") === "checked";

  return !checked;
}

function isExpanded(element: HTMLElement) {
  return (
    element.getAttribute("aria-expanded") === "true" ||
    element.getAttribute("data-panel-open") !== null ||
    element.getAttribute("data-open") !== null
  );
}
