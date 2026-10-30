import type { CSSProperties } from "react";

/**
 * The one working accent, for links and selection.
 *
 * Chosen as a PAIR, not a single colour. The register runs a different value on
 * each ground (blue-600 on the light one, blue-400 on the dark) because a
 * single hue cannot clear 4.5:1 against both a cream page and a near-black one.
 * Every preset here was measured against both grounds AND against the ink that
 * sits on top of it when the accent is used as a button fill; see
 * .agent/check-accent-contrast.mjs, which is run as a gate.
 *
 * Persisted like the theme, design register, money colours and typefaces: a
 * cookie the server reads while rendering, so the first paint is already right.
 */

export const ACCENT_COOKIE = "koban_accent";

export interface AccentPreset {
  /** Value on the dark ground. */
  dark: string;
  label: string;
  /** Value on the light ground. */
  light: string;
}

export const ACCENTS = {
  amber: { dark: "#fbbf24", label: "Amber", light: "#b45309" },
  blue: { dark: "#60a5fa", label: "Blue", light: "#2563eb" },
  green: { dark: "#4ade80", label: "Green", light: "#15803d" },
  indigo: { dark: "#818cf8", label: "Indigo", light: "#4338ca" },
  rose: { dark: "#fb7185", label: "Rose", light: "#be123c" },
  slate: { dark: "#94a3b8", label: "Slate", light: "#475569" },
  teal: { dark: "#2dd4bf", label: "Teal", light: "#0f766e" },
  violet: { dark: "#a78bfa", label: "Violet", light: "#7c3aed" }
} as const satisfies Record<string, AccentPreset>;

export type AccentId = keyof typeof ACCENTS;

/** What quiet.css already declares, so choosing it emits no inline style. */
export const ACCENT_DEFAULT: AccentId = "blue";

export const ACCENT_ORDER: readonly AccentId[] = (Object.keys(ACCENTS) as AccentId[]).sort(
  (left, right) => ACCENTS[left].label.localeCompare(ACCENTS[right].label)
);

export function isAccentId(value: string): value is AccentId {
  return Object.hasOwn(ACCENTS, value);
}

/**
 * Narrows a cookie value to a known preset id.
 *
 * Deliberately an id and never a raw colour: the value ends up inside a CSS
 * custom property on the document root, and an allowlist of ids means nothing a
 * cookie carries can ever reach the stylesheet as arbitrary text.
 */
export function parseAccent(value: string | undefined): AccentId {
  const candidate = (value ?? "").trim();
  return candidate && isAccentId(candidate) ? candidate : ACCENT_DEFAULT;
}

/**
 * Inline custom properties for the document root.
 *
 * Sets both ground-specific values rather than one resolved colour, because an
 * inline style cannot know which theme is active and the theme can flip on the
 * client without a request. quiet.css picks between them (`--q-accent-light` in
 * the light block, `--q-accent-dark` under .dark), so the correct one applies
 * immediately on toggle with no round trip.
 *
 * Returns nothing at the default, leaving the stylesheet authoritative.
 */
export function accentStyle(id: AccentId): CSSProperties | undefined {
  if (id === ACCENT_DEFAULT) {
    return undefined;
  }

  return {
    "--q-accent-dark": ACCENTS[id].dark,
    "--q-accent-light": ACCENTS[id].light
  } as CSSProperties;
}
