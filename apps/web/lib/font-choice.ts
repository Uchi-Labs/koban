import type { CSSProperties } from "react";

/**
 * Typefaces for the app shell, chosen as two independent axes: the body face
 * that carries figures and tables, and the display face for titles.
 *
 * This replaced a list of fixed pairings. Pairings meant one entry per
 * combination, so twenty-two cards to scroll for what is really two questions,
 * and no way to put a serif over a body face nobody had thought to pair it
 * with. Two dropdowns cover every combination and are two clicks.
 *
 * Every family is self-hosted: local files in app/fonts/ declared by
 * app/fonts.ts, or Google faces that next/font downloads and serves from this
 * origin at build time. That is a requirement, not a preference: the CSP allows
 * `font-src 'self' data:` (next.config.ts), so a third-party webfont host would
 * be blocked outright.
 *
 * Persisted the same way the theme, design register and money colours are: a
 * cookie the server reads while rendering, so the first paint already uses the
 * chosen faces instead of flashing the defaults and reflowing on hydration.
 */

export const FONT_CHOICE_COOKIE = "koban_font";

const SYSTEM_SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const SYSTEM_SERIF = "ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const SYSTEM_MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

export type FontKind = "mono" | "sans" | "serif";

export interface FontFamily {
  /** Grouping in the dropdown, and the fallback stack a face falls back into. */
  kind: FontKind;
  label: string;
  /** Full CSS font-family value, including its fallback stack. */
  stack: string;
}

const withFallback = (variable: string, kind: FontKind) => {
  const fallback = kind === "serif" ? SYSTEM_SERIF : kind === "mono" ? SYSTEM_MONO : SYSTEM_SANS;
  return `var(${variable}), ${fallback}`;
};

const family = (variable: string, label: string, kind: FontKind): FontFamily => ({
  kind,
  label,
  stack: withFallback(variable, kind)
});

export const FONT_FAMILIES = {
  alegreya: family("--font-alegreya-sans", "Alegreya Sans", "sans"),
  amulya: family("--font-amulya", "Amulya", "sans"),
  apercu: family("--font-apercu", "Apercu", "sans"),
  apercuMono: family("--font-apercu-mono", "Apercu Mono", "mono"),
  averia: family("--font-averia", "Averia Serif Libre", "serif"),
  azeret: family("--font-azeret-mono", "Azeret Mono", "mono"),
  bespoke: family("--font-bespoke-sans", "Bespoke Sans", "sans"),
  cabinet: family("--font-quiet-display", "Cabinet Grotesk", "sans"),
  clarendon: family("--font-clarendon", "Clarendon", "serif"),
  crimson: family("--font-crimson-pro", "Crimson Pro", "serif"),
  gambetta: family("--font-gambetta", "Gambetta", "serif"),
  inter: family("--font-inter", "Inter", "sans"),
  karma: family("--font-karma", "Karma", "serif"),
  lora: family("--font-lora", "Lora", "serif"),
  munson: family("--font-munson", "Munson", "serif"),
  nunito: family("--font-nunito", "Nunito", "sans"),
  satoshi: family("--font-quiet-sans", "Satoshi", "sans"),
  sora: family("--font-sora", "Sora", "sans"),
  spaceMono: family("--font-space-mono", "Space Mono", "mono"),
  synonym: family("--font-synonym", "Synonym", "sans"),
  system: { kind: "sans", label: "System", stack: SYSTEM_SANS },
  tabular: family("--font-tabular", "Tabular", "sans"),
  workSans: family("--font-work-sans", "Work Sans", "sans")
} as const satisfies Record<string, FontFamily>;

export type FontFamilyId = keyof typeof FONT_FAMILIES;

export interface FontChoice {
  body: FontFamilyId;
  display: FontFamilyId;
}

/** The quiet register's own pairing, and what quiet.css declares by default. */
export const FONT_CHOICE_DEFAULT: FontChoice = { body: "satoshi", display: "cabinet" };

/** Sans first, then serif, then monospace; alphabetical inside each group. */
export const FONT_FAMILY_ORDER: readonly FontFamilyId[] = (
  Object.keys(FONT_FAMILIES) as FontFamilyId[]
).sort((left, right) => {
  const rank: Record<FontKind, number> = { sans: 0, serif: 1, mono: 2 };
  const byKind = rank[FONT_FAMILIES[left].kind] - rank[FONT_FAMILIES[right].kind];
  return byKind !== 0 ? byKind : FONT_FAMILIES[left].label.localeCompare(FONT_FAMILIES[right].label);
});

export function isFontFamilyId(value: string): value is FontFamilyId {
  return Object.hasOwn(FONT_FAMILIES, value);
}

/** `<body>,<display>`; anything unrecognised falls back to that axis's default. */
export function parseFontChoice(value: string | undefined): FontChoice {
  const [body, display] = (value ?? "").split(",", 2).map((part) => part.trim());

  return {
    body: body && isFontFamilyId(body) ? body : FONT_CHOICE_DEFAULT.body,
    display: display && isFontFamilyId(display) ? display : FONT_CHOICE_DEFAULT.display
  };
}

export function serializeFontChoice({ body, display }: FontChoice): string {
  return `${body},${display}`;
}

export function isDefaultFontChoice({ body, display }: FontChoice): boolean {
  return body === FONT_CHOICE_DEFAULT.body && display === FONT_CHOICE_DEFAULT.display;
}

/**
 * Inline custom properties for the document root.
 *
 * Sets the quiet register's two variables and Ink & Mint's single one together,
 * so a choice survives toggling between the designs. Returns nothing at the
 * default, leaving the stylesheets authoritative on an untouched install.
 */
export function fontChoiceStyle(choice: FontChoice): CSSProperties | undefined {
  if (isDefaultFontChoice(choice)) {
    return undefined;
  }

  return {
    "--font-sans": FONT_FAMILIES[choice.body].stack,
    "--q-font-display": FONT_FAMILIES[choice.display].stack,
    "--q-font-sans": FONT_FAMILIES[choice.body].stack
  } as CSSProperties;
}
