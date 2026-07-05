"use client";

/*
 * Subtle interface audio, synthesized with WebAudio — no assets.
 * Inspired by audio.raphaelsalaja.com: quiet, short, warm sounds that
 * confirm rather than announce. Everything routes through one gain node
 * kept low; a persisted mute switch lives in localStorage.
 */

const MUTE_KEY = "ai-finances:ui-sound-muted";

let context: AudioContext | null = null;
let master: GainNode | null = null;

function getContext(): { context: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (window.localStorage.getItem(MUTE_KEY) === "true") {
    return null;
  }

  if (!context) {
    const Ctor = window.AudioContext;
    if (!Ctor) {
      return null;
    }
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.22; // ponytail: single global loudness ceiling
    master.connect(context.destination);
  }
  if (context.state === "suspended") {
    void context.resume();
  }

  return master ? { context, master } : null;
}

function note(frequency: number, startAt: number, duration: number, type: OscillatorType = "sine", peak = 1) {
  const audio = getContext();
  if (!audio) {
    return;
  }

  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  const t = audio.context.currentTime + startAt;

  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  oscillator.connect(gain);
  gain.connect(audio.master);
  oscillator.start(t);
  oscillator.stop(t + duration + 0.02);
}

/** Soft tick for presses. */
export function playTap() {
  note(1150, 0, 0.05, "triangle", 0.5);
}

/** Even softer, lower tick — navigation and row selection. */
export function playNav() {
  note(880, 0, 0.045, "triangle", 0.4);
}

/** Small two-state toggle blip (checkboxes, switches, tabs). */
export function playToggle() {
  note(1320, 0, 0.04, "sine", 0.45);
}

/**
 * Global press sounds via event delegation: one listener covers every
 * current and future interactive element. Returns an unsubscribe fn.
 */
export function attachGlobalUiSounds(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const interactive = target.closest(
      'button, [role="button"], a[href], [role="tab"], [role="option"], input[type="checkbox"], [role="checkbox"], [role="menuitem"], [data-slot="select-trigger"]'
    );
    if (!interactive || interactive.ariaDisabled === "true" || (interactive as HTMLButtonElement).disabled) {
      return;
    }

    const role = interactive.getAttribute("role");
    if (role === "tab" || role === "checkbox" || interactive.matches('input[type="checkbox"]')) {
      playToggle();
    } else if (interactive.matches("a[href]")) {
      playNav();
    } else {
      playTap();
    }
  };

  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
}

/** Two quiet ascending notes for a completed action. */
export function playSuccess() {
  note(660, 0, 0.09, "sine", 0.7);
  note(990, 0.09, 0.16, "sine", 0.55);
}

/** Low, short — something went wrong. */
export function playError() {
  note(220, 0, 0.13, "triangle", 0.6);
  note(180, 0.1, 0.16, "triangle", 0.45);
}

export function isUiSoundMuted(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "true";
}

export function setUiSoundMuted(muted: boolean) {
  window.localStorage.setItem(MUTE_KEY, String(muted));
}
