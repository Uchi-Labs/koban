// Pure color math + petal geometry for the Bloom category color picker.
// No DOM access here so it stays unit-testable; the component layer handles
// the getComputedStyle-based CSS→hex normalization for legacy oklch values.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

export type PetalRing = "inner" | "outer";

export interface PetalHue {
  h: number;
  s: number;
  l: number;
  ring: PetalRing;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function channelToHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

/** Accepts #rgb / #rrggbb (with or without leading #). Returns #rrggbb lowercase, or null. */
export function normalizeHex(input: string | undefined | null): string | null {
  if (!input) {
    return null;
  }

  let value = input.trim().replace(/^#/, "");

  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    value = value
      .split("")
      .map((char) => char + char)
      .join("");
  }

  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return `#${value.toLowerCase()}`;
  }

  return null;
}

export function isValidHex(input: string | undefined | null): boolean {
  return normalizeHex(input) !== null;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);

  if (!normalized) {
    return null;
  }

  const int = Number.parseInt(normalized.slice(1), 16);

  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = clamp01(amount);

  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t
  };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = l - chroma / 2;

  let rgb: [number, number, number];

  if (hue < 60) {
    rgb = [chroma, secondary, 0];
  } else if (hue < 120) {
    rgb = [secondary, chroma, 0];
  } else if (hue < 180) {
    rgb = [0, chroma, secondary];
  } else if (hue < 240) {
    rgb = [0, secondary, chroma];
  } else if (hue < 300) {
    rgb = [secondary, 0, chroma];
  } else {
    rgb = [chroma, 0, secondary];
  }

  return {
    r: (rgb[0] + match) * 255,
    g: (rgb[1] + match) * 255,
    b: (rgb[2] + match) * 255
  };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));

    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }

    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }

  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  return rgbToHex(hslToRgb({ h, s, l }));
}

function linearToSrgbChannel(value: number): number {
  const clamped = clamp01(value);
  const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

/**
 * Parse an oklch() string and convert to #rrggbb (Björn Ottosson's oklab→sRGB).
 * Handles `oklch(L C H)`, percentage L, and a trailing `/ alpha` (ignored).
 * Some Chromium builds hand oklch back verbatim from canvas/getComputedStyle, so
 * the picker relies on this rather than the browser to normalize legacy colors.
 */
export function oklchToHex(input: string): string | null {
  const match = input.trim().match(/^oklch\(\s*([^)]+)\)$/i);

  if (!match) {
    return null;
  }

  const parts = match[1]
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);

  if (parts.length < 3) {
    return null;
  }

  const parseComponent = (raw: string): number => {
    if (raw.endsWith("%")) {
      return Number.parseFloat(raw) / 100;
    }
    return Number.parseFloat(raw);
  };

  const lRaw = parts[0];
  const l = lRaw.endsWith("%") ? Number.parseFloat(lRaw) / 100 : Number.parseFloat(lRaw);
  const c = parseComponent(parts[1]);
  const h = Number.parseFloat(parts[2]);

  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h)) {
    return null;
  }

  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const lCubed = lPrime ** 3;
  const mCubed = mPrime ** 3;
  const sCubed = sPrime ** 3;

  const rLinear = 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed;
  const gLinear = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed;
  const bLinear = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed;

  return rgbToHex({
    r: linearToSrgbChannel(rLinear),
    g: linearToSrgbChannel(gLinear),
    b: linearToSrgbChannel(bLinear)
  });
}

/**
 * Shade a base hue toward white (lighten) or black (darken).
 * t = 0 → light tint, t = 0.5 → the pure hue, t = 1 → black.
 */
export function shadeColor(baseHex: string, t: number): string {
  const rgb = hexToRgb(baseHex);

  if (!rgb) {
    return normalizeHex(baseHex) ?? "#000000";
  }

  const clamped = clamp01(t);

  if (clamped <= 0.5) {
    const towardWhite = (1 - clamped / 0.5) * 0.74;
    return rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, towardWhite));
  }

  const towardBlack = (clamped - 0.5) / 0.5;
  return rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, towardBlack));
}

// ── Petal set ──────────────────────────────────────────────────────────────
// 15 hues, spectrum-ordered, tuned for the dark Ink & Mint surface: moderate
// saturation + mid lightness so they read as jewel tones rather than screaming
// against --background. Outer ring 9, inner ring 6. A mint (~168) lives in the
// set so the app accent is directly reachable.

export const OUTER_PETALS: PetalHue[] = [
  { h: 6, s: 0.75, l: 0.62, ring: "outer" },
  { h: 30, s: 0.79, l: 0.6, ring: "outer" },
  { h: 52, s: 0.75, l: 0.62, ring: "outer" },
  { h: 96, s: 0.59, l: 0.58, ring: "outer" },
  { h: 150, s: 0.59, l: 0.56, ring: "outer" },
  { h: 186, s: 0.65, l: 0.6, ring: "outer" },
  { h: 210, s: 0.71, l: 0.62, ring: "outer" },
  { h: 258, s: 0.59, l: 0.64, ring: "outer" },
  { h: 320, s: 0.65, l: 0.64, ring: "outer" }
];

export const INNER_PETALS: PetalHue[] = [
  { h: 18, s: 0.71, l: 0.66, ring: "inner" },
  { h: 44, s: 0.69, l: 0.66, ring: "inner" },
  { h: 122, s: 0.53, l: 0.62, ring: "inner" },
  { h: 168, s: 0.59, l: 0.62, ring: "inner" },
  { h: 236, s: 0.57, l: 0.68, ring: "inner" },
  { h: 288, s: 0.55, l: 0.66, ring: "inner" }
];

/** Flat list, outer ring first (clockwise from top), then inner ring. */
export const PETAL_HUES: PetalHue[] = [...OUTER_PETALS, ...INNER_PETALS];

export function petalHex(petal: PetalHue): string {
  return hslToHex(petal.h, petal.s, petal.l);
}

/** Index of the petal whose hue is closest to a given color, for initial focus. */
export function nearestPetalIndex(hex: string): number {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return 0;
  }

  const target = rgbToHsl(rgb);
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;

  PETAL_HUES.forEach((petal, index) => {
    const raw = Math.abs(petal.h - target.h) % 360;
    const delta = Math.min(raw, 360 - raw);

    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });

  return bestIndex;
}

// ── Shade arc geometry ───────────────────────────────────────────────────────
// The arc is a slice of a circle centred on the flower, sweeping the right side
// from just above the top down past the equator (the "comma" reach). t runs
// 0→1 from the top of the arc to the tail.

export const ARC_START_DEG = -72;
export const ARC_END_DEG = 92;

export function arcAngleForT(t: number): number {
  return ARC_START_DEG + clamp01(t) * (ARC_END_DEG - ARC_START_DEG);
}

export function tForArcAngle(angleDeg: number): number {
  return clamp01((angleDeg - ARC_START_DEG) / (ARC_END_DEG - ARC_START_DEG));
}

export function arcPoint(
  t: number,
  radius: number,
  centerX: number,
  centerY: number
): { x: number; y: number } {
  const radians = (arcAngleForT(t) * Math.PI) / 180;

  return {
    x: centerX + radius * Math.cos(radians),
    y: centerY + radius * Math.sin(radians)
  };
}

/** Angle (deg) of a pointer relative to the arc centre, used while dragging. */
export function angleForPoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number
): number {
  return (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
}
