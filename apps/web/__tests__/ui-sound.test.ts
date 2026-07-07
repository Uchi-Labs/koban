import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attachGlobalUiSounds,
  isUiSoundEnabled,
  isUiSoundMuted,
  playClose,
  playError,
  playNav,
  playOpen,
  playSelect,
  playSuccess,
  playSync,
  playTap,
  playToast,
  playToggle,
  playToggleOff,
  playToggleOn,
  prepareUiSound,
  setUiSoundMuted,
} from "@/lib/ui-sound";

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

describe("ui-sound palette", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage: Storage = {
      clear: () => store.clear(),
      getItem: (key) => store.get(key) ?? null,
      key: (index) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
      removeItem: (key) => {
        store.delete(key);
      },
      setItem: (key, value) => {
        store.set(key, value);
      },
    };

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  });

  afterEach(() => {
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    }
  });

  it("keeps every sound export callable without AudioContext", () => {
    expect(() => {
      prepareUiSound();
      playTap();
      playNav();
      playSelect();
      playToggleOn();
      playToggleOff();
      playToggle(true);
      playToggle(false);
      playSuccess();
      playError();
      playToast();
      playOpen();
      playClose();
      playSync();
    }).not.toThrow();
  });

  it("attaches global UI sounds without requiring browser audio APIs", () => {
    const detach = attachGlobalUiSounds();

    expect(typeof detach).toBe("function");
    expect(() => detach()).not.toThrow();
  });

  it("persists the explicit sound preference", () => {
    setUiSoundMuted(true);

    expect(isUiSoundMuted()).toBe(true);
    expect(isUiSoundEnabled()).toBe(false);

    setUiSoundMuted(false);

    expect(isUiSoundMuted()).toBe(false);
    expect(isUiSoundEnabled()).toBe(true);
  });
});
