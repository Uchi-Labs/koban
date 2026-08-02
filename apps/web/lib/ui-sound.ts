"use client";

import {
  defineSound,
  ensureReady,
  setMasterVolume,
  type PlayOptions,
  type SoundDefinition,
} from "@web-kits/audio";
import { triggerUiHaptic } from "@/lib/ui-haptics";

const UI_SOUND_MUTED_STORAGE_KEY = "ai-finances:ui-sound-muted";

const SOUND_MUTED_CHANGE_EVENT = "ai-finances:ui-sound-muted-change";
const MASTER_VOLUME = 0.72;

export const UI_SOUND_NAMES = [
  "tap",
  "hover",
  "select",
  "toggleOn",
  "toggleOff",
  "tabSwitch",
  "expand",
  "collapse",
  "success",
  "error",
  "toast",
  "open",
  "close",
  "send",
  "copy",
  "sync",
] as const;

export type UiSoundName = (typeof UI_SOUND_NAMES)[number];

type UiSoundOverride = UiSoundName | "none";

const validSoundNames = new Set<string>(UI_SOUND_NAMES);

// Voices are the "crisp" patch from the @web-kits/audio registry (MIT,
// github.com/raphaelsalaja/audio), plus drawer/sync voices from its "core"
// patch — a coherent designed palette instead of hand-rolled ticks. Each
// definition is transplanted verbatim from the patch JSON.

// crisp:tap
const tapDefinition = {
  "source": {
    "type": "sine",
    "frequency": 1300,
    "fm": {
      "ratio": 0.5,
      "depth": 100
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.015,
    "sustain": 0,
    "release": 0.005
  },
  "gain": 0.2
} satisfies SoundDefinition;

// crisp:hover
const hoverDefinition = {
  "source": {
    "type": "sine",
    "frequency": 1500,
    "fm": {
      "ratio": 0.5,
      "depth": 40
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.015,
    "sustain": 0,
    "release": 0.005
  },
  "gain": 0.06
} satisfies SoundDefinition;

// crisp:select
const selectDefinition = {
  "source": {
    "type": "sine",
    "frequency": 1200,
    "fm": {
      "ratio": 1,
      "depth": 80
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.04,
    "sustain": 0,
    "release": 0.012
  },
  "gain": 0.18
} satisfies SoundDefinition;

// crisp:toggle-on
const toggleOnDefinition = {
  "layers": [
    {
      "source": {
        "type": "sine",
        "frequency": 1047,
        "fm": {
          "ratio": 1.5,
          "depth": 60
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.03,
        "sustain": 0,
        "release": 0.01
      },
      "gain": 0.2
    },
    {
      "source": {
        "type": "sine",
        "frequency": 1568,
        "fm": {
          "ratio": 1.5,
          "depth": 50
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.03,
        "sustain": 0,
        "release": 0.01
      },
      "delay": 0.025,
      "gain": 0.18
    }
  ]
} satisfies SoundDefinition;

// crisp:toggle-off
const toggleOffDefinition = {
  "layers": [
    {
      "source": {
        "type": "sine",
        "frequency": 1568,
        "fm": {
          "ratio": 1.5,
          "depth": 60
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.03,
        "sustain": 0,
        "release": 0.01
      },
      "gain": 0.2
    },
    {
      "source": {
        "type": "sine",
        "frequency": 1047,
        "fm": {
          "ratio": 1.5,
          "depth": 50
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.03,
        "sustain": 0,
        "release": 0.01
      },
      "delay": 0.025,
      "gain": 0.18
    }
  ]
} satisfies SoundDefinition;

// crisp:success
const successDefinition = {
  "layers": [
    {
      "source": {
        "type": "sine",
        "frequency": 523,
        "fm": {
          "ratio": 2,
          "depth": 100
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.12,
        "sustain": 0,
        "release": 0.04
      },
      "gain": 0.18
    },
    {
      "source": {
        "type": "sine",
        "frequency": 659,
        "fm": {
          "ratio": 2,
          "depth": 80
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.1,
        "sustain": 0,
        "release": 0.04
      },
      "delay": 0.06,
      "gain": 0.16
    },
    {
      "source": {
        "type": "sine",
        "frequency": 784,
        "fm": {
          "ratio": 2,
          "depth": 70
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.1,
        "sustain": 0,
        "release": 0.04
      },
      "delay": 0.12,
      "gain": 0.14
    }
  ]
} satisfies SoundDefinition;

// crisp:error
const errorDefinition = {
  "layers": [
    {
      "source": {
        "type": "sine",
        "frequency": {
          "start": 400,
          "end": 200
        },
        "fm": {
          "ratio": 1.5,
          "depth": 150
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.1,
        "sustain": 0,
        "release": 0.03
      },
      "gain": 0.22
    },
    {
      "source": {
        "type": "sine",
        "frequency": {
          "start": 250,
          "end": 120
        },
        "fm": {
          "ratio": 1.5,
          "depth": 120
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.08,
        "sustain": 0,
        "release": 0.025
      },
      "delay": 0.03,
      "gain": 0.15
    }
  ]
} satisfies SoundDefinition;

// crisp:notification
const toastDefinition = {
  "layers": [
    {
      "source": {
        "type": "sine",
        "frequency": 780,
        "fm": {
          "ratio": 1.5,
          "depth": 120
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.15,
        "sustain": 0,
        "release": 0.05
      },
      "gain": 0.18
    },
    {
      "source": {
        "type": "sine",
        "frequency": 1170,
        "fm": {
          "ratio": 1.5,
          "depth": 100
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.12,
        "sustain": 0,
        "release": 0.04
      },
      "delay": 0.08,
      "gain": 0.15
    }
  ]
} satisfies SoundDefinition;

// crisp:tab-switch
const tabSwitchDefinition = {
  "source": {
    "type": "sine",
    "frequency": {
      "start": 1000,
      "end": 1400
    },
    "fm": {
      "ratio": 0.5,
      "depth": 50
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.04,
    "sustain": 0,
    "release": 0.012
  },
  "gain": 0.16
} satisfies SoundDefinition;

// crisp:expand
const expandDefinition = {
  "source": {
    "type": "sine",
    "frequency": {
      "start": 600,
      "end": 900
    },
    "fm": {
      "ratio": 1,
      "depth": 50
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.06,
    "sustain": 0,
    "release": 0.02
  },
  "gain": 0.12
} satisfies SoundDefinition;

// crisp:collapse
const collapseDefinition = {
  "source": {
    "type": "sine",
    "frequency": {
      "start": 900,
      "end": 600
    },
    "fm": {
      "ratio": 1,
      "depth": 50
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.06,
    "sustain": 0,
    "release": 0.02
  },
  "gain": 0.12
} satisfies SoundDefinition;

// crisp:send
const sendDefinition = {
  "source": {
    "type": "sine",
    "frequency": {
      "start": 500,
      "end": 1200
    },
    "fm": {
      "ratio": 1,
      "depth": 80
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.1,
    "sustain": 0,
    "release": 0.03
  },
  "gain": 0.16
} satisfies SoundDefinition;

// crisp:copy
const copyDefinition = {
  "layers": [
    {
      "source": {
        "type": "sine",
        "frequency": 1200,
        "fm": {
          "ratio": 0.5,
          "depth": 60
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.02,
        "sustain": 0,
        "release": 0.006
      },
      "gain": 0.16
    },
    {
      "source": {
        "type": "sine",
        "frequency": 1500,
        "fm": {
          "ratio": 0.5,
          "depth": 50
        }
      },
      "envelope": {
        "attack": 0,
        "decay": 0.02,
        "sustain": 0,
        "release": 0.006
      },
      "delay": 0.035,
      "gain": 0.14
    }
  ]
} satisfies SoundDefinition;

// core:drawer-open
const openDefinition = {
  "source": {
    "type": "sine",
    "frequency": {
      "start": 350,
      "end": 1000
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.1,
    "sustain": 0,
    "release": 0.03
  },
  "gain": 0.08
} satisfies SoundDefinition;

// core:drawer-close
const closeDefinition = {
  "source": {
    "type": "sine",
    "frequency": {
      "start": 800,
      "end": 350
    }
  },
  "envelope": {
    "attack": 0,
    "decay": 0.1,
    "sustain": 0,
    "release": 0.03
  },
  "gain": 0.06
} satisfies SoundDefinition;

// core:sync
const syncDefinition = {
  "layers": [
    {
      "source": {
        "type": "sine",
        "frequency": 523
      },
      "envelope": {
        "attack": 0,
        "decay": 0.015,
        "sustain": 0,
        "release": 0.005
      },
      "gain": 0.14
    },
    {
      "source": {
        "type": "sine",
        "frequency": 784
      },
      "envelope": {
        "attack": 0,
        "decay": 0.015,
        "sustain": 0,
        "release": 0.005
      },
      "delay": 0.04,
      "gain": 0.12
    }
  ]
} satisfies SoundDefinition;

const soundPlayers = {
  tap: defineSound(tapDefinition),
  hover: defineSound(hoverDefinition),
  select: defineSound(selectDefinition),
  toggleOn: defineSound(toggleOnDefinition),
  toggleOff: defineSound(toggleOffDefinition),
  tabSwitch: defineSound(tabSwitchDefinition),
  expand: defineSound(expandDefinition),
  collapse: defineSound(collapseDefinition),
  success: defineSound(successDefinition),
  error: defineSound(errorDefinition),
  toast: defineSound(toastDefinition),
  open: defineSound(openDefinition),
  close: defineSound(closeDefinition),
  send: defineSound(sendDefinition),
  copy: defineSound(copyDefinition),
  sync: defineSound(syncDefinition),
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

/** Small per-play detune/volume jitter so repeated sounds read as natural
 *  variations of one voice rather than a robotic repeat. */
function jitter(): PlayOptions {
  return {
    detune: (Math.random() - 0.5) * 22,
    volume: 0.9 + Math.random() * 0.1,
  };
}

function playUiSound(name: UiSoundName, opts?: PlayOptions) {
  // Haptics fire first and independently: they must not inherit audio's gates.
  // A device with no AudioContext (or with sound muted) can still vibrate, and
  // waiting on `readyPromise` would land the buzz after the tap it belongs to.
  triggerUiHaptic(name);

  if (!userGestureSeen || !canAttemptAudio()) {
    return;
  }

  beginUiSoundGesture();
  void readyPromise?.then((ready) => {
    if (!ready || isUiSoundMuted()) {
      return;
    }

    try {
      soundPlayers[name]({ ...jitter(), ...opts });
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

export function playHover() {
  playUiSound("hover");
}

export function playSend() {
  playUiSound("send");
}

export function playCopy() {
  playUiSound("copy");
}

export function playExpand(expanded: boolean) {
  playUiSound(expanded ? "collapse" : "expand");
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

  // Hover ticks are opt-in per element (`data-sound-hover`) and rate-limited,
  // so only deliberately chosen surfaces whisper on pointer travel.
  let lastHoverAt = 0;
  let lastHoverTarget: HTMLElement | null = null;
  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-sound-hover]");
    if (!target || target === lastHoverTarget || isDisabled(target)) {
      if (!target) {
        lastHoverTarget = null;
      }
      return;
    }

    const now = performance.now();
    if (now - lastHoverAt < 90) {
      lastHoverTarget = target;
      return;
    }

    lastHoverAt = now;
    lastHoverTarget = target;
    playUiSound("hover", { volume: 0.8 });
  };

  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("keydown", onKeyDown, { capture: true });
  document.addEventListener("pointerover", onPointerOver, { capture: true, passive: true });

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    document.removeEventListener("pointerover", onPointerOver, { capture: true });
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
    return isExpanded(interactive) ? "collapse" : "expand";
  }

  if (interactive.matches("[role='tab'], [data-slot='tabs-trigger']")) {
    return "tabSwitch";
  }

  if (
    interactive.matches(
      "[role='option'], [role='menuitem'], [data-slot='select-item'], [data-slot='command-item']"
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
