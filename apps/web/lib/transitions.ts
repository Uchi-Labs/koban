"use client";

import { useEffect, useRef, useState } from "react";

export function forceReflow(element: HTMLElement | SVGElement | null | undefined) {
  if (!element) {
    return;
  }

  void element.getBoundingClientRect();
}

function cssDurationMs(name: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return raw.endsWith("s") && !raw.endsWith("ms") ? parsed * 1000 : parsed;
}

export function useHoverCapable() {
  const [hoverCapable, setHoverCapable] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setHoverCapable(media.matches);

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return hoverCapable;
}

export function useTextSwapValue(value: string) {
  const ref = useRef<HTMLElement>(null);
  const [displayValue, setDisplayValue] = useState(value);
  const [phaseClass, setPhaseClass] = useState("");
  const timeoutRef = useRef<number | null>(null);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      setDisplayValue(value);
      return;
    }

    if (value === displayValue) {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayValue(value);
      setPhaseClass("");
      return;
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setPhaseClass("is-exit");
    timeoutRef.current = window.setTimeout(() => {
      setDisplayValue(value);
      setPhaseClass("is-enter-start");
      forceReflow(ref.current);
      setPhaseClass("");
      timeoutRef.current = null;
    }, cssDurationMs("--text-swap-dur", 150));
  }, [displayValue, value]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { displayValue, phaseClass, ref };
}

export function useShakeReplay(triggerKey: unknown, options?: { shakeOnMount?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [shaking, setShaking] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (!options?.shakeOnMount) {
        return;
      }
    }

    const element = ref.current;

    if (!element) {
      return;
    }

    setShaking(false);
    requestAnimationFrame(() => {
      forceReflow(element);
      setShaking(true);
      window.setTimeout(() => setShaking(false), cssDurationMs("--shake-dur-a", 80) * 2 + cssDurationMs("--shake-dur-b", 60) * 2 + 20);
    });
  }, [options?.shakeOnMount, triggerKey]);

  return { ref, shaking };
}

export function applyAvatarGroupShift(root: HTMLElement | null, activeIndex: number | null, phase: "in" | "out") {
  if (!root) {
    return;
  }

  const avatars = Array.from(root.querySelectorAll<HTMLElement>(".t-avatar"));
  const styles = getComputedStyle(document.documentElement);
  const readNumber = (name: string, fallback: number) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const readEase = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const lift = readNumber("--avatar-lift", -4);
  const falloff = readNumber("--avatar-falloff", 0.45);
  const scale = readNumber("--avatar-scale", 1.05);
  const timingFunction =
    phase === "out"
      ? readEase("--avatar-ease-out", "cubic-bezier(0.34, 3.85, 0.64, 1)")
      : readEase("--avatar-ease-in", "cubic-bezier(0.22, 1, 0.36, 1)");

  avatars.forEach((element, index) => {
    element.style.transitionTimingFunction = timingFunction;

    if (activeIndex === null) {
      element.style.setProperty("--shift", "0px");
      element.style.setProperty("--scale-active", "1");
      return;
    }

    const distance = Math.abs(index - activeIndex);
    element.style.setProperty("--shift", `${(lift * Math.pow(falloff, distance)).toFixed(3)}px`);
    element.style.setProperty("--scale-active", index === activeIndex ? String(scale) : "1");
  });
}

export function configureSuccessCheckPaths(root: HTMLElement | null) {
  if (!root) {
    return;
  }

  root.querySelectorAll<SVGPathElement>("svg path").forEach((path) => {
    const pathLength = typeof path.getTotalLength === "function" ? path.getTotalLength() : 24;
    const length = Math.ceil(pathLength + 1);
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
  });
}

export function splitPopDigits(text: string) {
  const chars = Array.from(text);

  return chars.map((char, index) => ({
    char,
    stagger: index === chars.length - 2 ? "1" : index === chars.length - 1 ? "2" : undefined
  }));
}

export function runInputClearDissolve({
  onClear,
  placeholder,
  value,
  wrap
}: {
  onClear: () => void;
  placeholder: string;
  value: string;
  wrap: HTMLElement | null;
}) {
  if (!wrap || !value) {
    onClear();
    return;
  }

  const input = wrap.querySelector<HTMLInputElement>("input");
  const mirror = wrap.querySelector<HTMLElement>(".t-clear-mirror");
  const placeholderLayer = wrap.querySelector<HTMLElement>(".t-clear-placeholder");
  const glow = wrap.querySelector<HTMLElement>(".t-clear-glow");

  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!input || !mirror || !placeholderLayer || !glow || reducedMotion) {
    onClear();
    return;
  }

  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const readNumber = (name: string, fallback: number) => {
    const parsed = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const total = readNumber("--clear-dur", 1000);
  const outDuration = readNumber("--clear-out-dur", 400);
  const inDuration = readNumber("--clear-in-dur", 400);
  const outFly = readNumber("--clear-out-fly", 12);
  const inFly = readNumber("--clear-in-fly", 12);
  const blur = readNumber("--clear-blur", 2);
  const glowDelay = readNumber("--glow-delay", 50);
  const glowPeakAt = readNumber("--glow-peak-at", 0.15);
  const glowOpacity = readNumber("--glow-opacity", root.classList.contains("dark") ? 0.85 : 0.42);
  const text = value.replace(/ /g, "\u00a0");

  mirror.textContent = text;
  placeholderLayer.textContent = placeholder;
  glow.style.background = buildInputClearGlow(input, wrap, value);
  glow.style.opacity = "0";
  wrap.classList.add("is-clearing");
  onClear();

  const startedAt = performance.now();
  const tick = (now: number) => {
    const elapsed = now - startedAt;
    const outProgress = Math.min(1, elapsed / outDuration);
    const inProgress = Math.min(1, elapsed / inDuration);

    mirror.style.transform = `translateY(${(outProgress * outFly).toFixed(1)}px)`;
    mirror.style.opacity = (1 - outProgress).toFixed(3);
    mirror.style.filter = `blur(${(outProgress * blur).toFixed(1)}px)`;

    placeholderLayer.style.transform = `translateY(${(-inFly + inProgress * inFly).toFixed(1)}px)`;
    placeholderLayer.style.opacity = (0.9 + inProgress * 0.1).toFixed(3);
    placeholderLayer.style.filter = `blur(${(blur - inProgress * blur).toFixed(1)}px)`;

    let glowProgress = 0;
    if (elapsed > glowDelay) {
      const normalized = Math.min(1, (elapsed - glowDelay) / Math.max(1, total - glowDelay));
      glowProgress = normalized < glowPeakAt ? normalized / glowPeakAt : 1 - (normalized - glowPeakAt) / (1 - glowPeakAt);
    }
    glow.style.opacity = (Math.max(0, glowProgress) * glowOpacity).toFixed(3);

    if (elapsed < total) {
      requestAnimationFrame(tick);
      return;
    }

    wrap.classList.remove("is-clearing");
    mirror.textContent = "";
    mirror.removeAttribute("style");
    placeholderLayer.removeAttribute("style");
    glow.removeAttribute("style");
  };

  requestAnimationFrame(tick);
}

function buildInputClearGlow(input: HTMLInputElement, wrap: HTMLElement, text: string) {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark") || root.getAttribute("data-theme") === "dark";
  const rgb = isDark ? "255,255,255" : "0,0,0";
  const fallbackGlow = `radial-gradient(ellipse 45% 10px at 20% 100%, rgba(${rgb},0.22), transparent)`;

  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
    return fallbackGlow;
  }

  let canvas: CanvasRenderingContext2D | null = null;
  try {
    canvas = document.createElement("canvas").getContext("2d");
  } catch {
    return fallbackGlow;
  }

  if (!canvas) {
    return fallbackGlow;
  }

  const inputStyles = getComputedStyle(input);
  const rootStyles = getComputedStyle(root);
  const spreadValue = Number.parseFloat(rootStyles.getPropertyValue("--glow-spread"));
  const spread = Number.isFinite(spreadValue) ? spreadValue : 1.5;
  const width = wrap.clientWidth || 280;
  const padLeft = Number.parseFloat(inputStyles.paddingLeft) || 12;
  const layers: string[] = [];
  let x = 0;

  canvas.font = inputStyles.font;
  text.split(/(\s+)/).forEach((segment) => {
    const segmentWidth = canvas.measureText(segment).width;

    if (segment.trim()) {
      const centerX = padLeft + x + segmentWidth / 2;
      const halfWidth = Math.max(segmentWidth * 0.45, 8) * spread;
      [
        [0, 0.8, 7, 0.22],
        [halfWidth * 0.45, 0.55, 8, 0.18],
        [halfWidth * -0.4, 0.65, 6, 0.16],
        [halfWidth * 0.15, 0.9, 5, 0.14]
      ].forEach(([dx, radiusWidthMultiplier, radiusHeight, alpha]) => {
        const layerX = (((centerX + dx) / width) * 100).toFixed(2);
        layers.push(
          `radial-gradient(ellipse ${Math.max(halfWidth * radiusWidthMultiplier, 2).toFixed(1)}px ${radiusHeight}px at ${layerX}% 100%, rgba(${rgb},${alpha}), transparent)`
        );
      });
    }

    x += segmentWidth;
  });

  return layers.join(", ");
}
