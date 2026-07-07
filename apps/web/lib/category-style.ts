import type { Category } from "@ai-finances/schema";

export const neutralCategoryEmoji = "🏷️";
export const neutralCategoryColor = "oklch(0.72 0.04 245)";

export const categoryColorPalette = [
  "oklch(0.72 0.13 162)",
  "oklch(0.76 0.13 194)",
  "oklch(0.72 0.14 228)",
  "oklch(0.68 0.14 265)",
  "oklch(0.72 0.14 306)",
  "oklch(0.72 0.15 350)",
  "oklch(0.72 0.16 30)",
  "oklch(0.78 0.15 72)",
  "oklch(0.76 0.13 105)",
  "oklch(0.68 0.12 138)",
  "oklch(0.7 0.09 245)",
  "oklch(0.74 0.05 250)"
] as const;

export const financeEmojiOptions = [
  "🏷️",
  "💵",
  "💳",
  "🧾",
  "🏦",
  "📈",
  "📉",
  "💰",
  "🪙",
  "🛒",
  "🛍️",
  "🎁",
  "🍽️",
  "🍔",
  "🍕",
  "☕",
  "🍺",
  "🥗",
  "🥑",
  "🥐",
  "🚗",
  "⛽",
  "🚌",
  "🚇",
  "🚕",
  "🚲",
  "✈️",
  "🏨",
  "🧳",
  "🛂",
  "🏠",
  "🏡",
  "🔑",
  "🛠️",
  "🧰",
  "💡",
  "💧",
  "🔥",
  "📱",
  "💻",
  "🖥️",
  "🎮",
  "🎬",
  "🎧",
  "🎟️",
  "🎨",
  "📚",
  "🏥",
  "💊",
  "🩺",
  "🧘",
  "🏋️",
  "🏃",
  "🐾",
  "👕",
  "👟",
  "💄",
  "✂️",
  "👶",
  "🎓",
  "🚌",
  "🧸",
  "🏫",
  "💼",
  "🧑‍💼",
  "📝",
  "📦",
  "📬",
  "🧹",
  "🧺",
  "🛡️",
  "📄",
  "⚖️",
  "🧮",
  "🏛️",
  "💸",
  "🔁",
  "📤",
  "📥",
  "🎯",
  "❤️",
  "🤝",
  "🌱",
  "🐕",
  "🅿️",
  "🚙",
  "🛣️",
  "🔌",
  "📺",
  "🎵",
  "📰",
  "📊",
  "🧑‍🍳",
  "🛏️",
  "🧴",
  "🧻",
  "🍎",
  "🥩",
  "🧊",
  "🍿",
  "🏖️",
  "🚢",
  "🗺️",
  "🧭",
  "⛺",
  "🎡",
  "🎲",
  "🧩",
  "🌐",
  "🔐",
  "🧑‍💻",
  "🧪",
  "🧯",
  "🪴",
  "🏷",
  "🧱",
  "🚿",
  "🛋️",
  "🪑",
  "🖼️",
  "🍰",
  "🧋",
  "🍷"
] as const;

const emojiRules: Array<[RegExp, string]> = [
  [/\b(income|salary|payroll|deposit|interest|dividend|bonus|refund)\b/i, "💵"],
  [/\b(grocer|grocery|groceries|supermarket|market|food)\b/i, "🛒"],
  [/\b(restaurant|dining|cafe|coffee|bar|lunch|dinner|takeout|delivery)\b/i, "🍽️"],
  [/\b(travel|flight|airline|hotel|lodging|vacation|trip|airbnb|uber|lyft)\b/i, "✈️"],
  [/\b(rent|mortgage|housing|home|apartment|hoa)\b/i, "🏠"],
  [/\b(utility|utilities|electric|power|gas|water|internet|phone)\b/i, "💡"],
  [/\b(transport|transportation|transit|metro|parking|fuel|gas station|car|auto)\b/i, "🚗"],
  [/\b(software|subscription|saas|cloud|hosting|app)\b/i, "💻"],
  [/\b(shopping|shop|retail|store|online|amazon)\b/i, "🛍️"],
  [/\b(transfer|payment|card payment|internal|savings)\b/i, "🔁"],
  [/\b(health|medical|doctor|pharmacy|dental|insurance)\b/i, "🏥"],
  [/\b(entertainment|movie|music|streaming|game|gaming)\b/i, "🎬"],
  [/\b(fitness|gym|sport|wellness)\b/i, "🏋️"],
  [/\b(education|school|tuition|book|course)\b/i, "🎓"],
  [/\b(gift|donation|charity)\b/i, "🎁"],
  [/\b(tax|legal|accounting|fee|fees)\b/i, "📄"],
  [/\b(invest|brokerage|stock|crypto|retirement)\b/i, "📈"],
  [/\b(child|kids|family|daycare)\b/i, "👶"],
  [/\b(pet|veterinary|vet)\b/i, "🐾"],
  [/\b(personal care|beauty|hair|salon|clothes|clothing)\b/i, "👕"]
];

export function inferCategoryEmoji(name: string | undefined, fallback = neutralCategoryEmoji): string {
  const normalized = (name ?? "").trim();

  if (!normalized) {
    return fallback;
  }

  for (const [pattern, emoji] of emojiRules) {
    if (pattern.test(normalized)) {
      return emoji;
    }
  }

  return fallback;
}

export function categoryPaletteColor(index: number): string {
  return categoryColorPalette[Math.abs(index) % categoryColorPalette.length] ?? neutralCategoryColor;
}

export function isCategoryColor(value: string | undefined): value is string {
  return Boolean(value && categoryColorPalette.includes(value as (typeof categoryColorPalette)[number]));
}

// ── CSS color trust boundary ────────────────────────────────────────────────
// User-picked colors (BloomColorPicker, hand-typed hex/oklch) land directly in
// inline styles (backgroundColor, box-shadow color-mix, etc.), so this is a
// strict allowlist of shapes, not a "does the browser accept it" check. Each
// pattern is fully anchored (^...$) and only admits digits, '.', '%', 'deg',
// whitespace, and the format's own punctuation — there is no path through
// which `var(...)`, `url(...)`, `calc(...)`, custom idents, or a stray `;`/`{`
// can match, so no separate blocklist is needed on top of this.
const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;
const NUM_PCT = String.raw`${NUM}%?`;
const ANGLE = String.raw`${NUM}(?:deg)?`;
const SEP = String.raw`\s*[,\s]\s*`;
const ALPHA = String.raw`(?:\s*[,/]\s*\d{1,3}(?:\.\d+)?%?\s*)?`;

const CSS_COLOR_PATTERNS: RegExp[] = [
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
  new RegExp(`^rgba?\\(\\s*${NUM_PCT}${SEP}${NUM_PCT}${SEP}${NUM_PCT}${ALPHA}\\)$`, "i"),
  new RegExp(`^hsla?\\(\\s*${ANGLE}${SEP}${NUM_PCT}${SEP}${NUM_PCT}${ALPHA}\\)$`, "i"),
  new RegExp(`^oklch\\(\\s*${NUM_PCT}\\s+${NUM_PCT}\\s+${ANGLE}${ALPHA}\\)$`, "i"),
  new RegExp(`^oklab\\(\\s*${NUM_PCT}\\s+${NUM_PCT}\\s+${NUM_PCT}${ALPHA}\\)$`, "i")
];

/**
 * Structural allowlist check for a raw CSS color string: `#rgb`/`#rrggbb`
 * hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklch()`, `oklab()` with purely
 * numeric (optionally `%`/`deg`-suffixed) arguments. Anything else — named
 * colors, `var()`, `url()`, `calc()`, or malformed/hostile strings — is
 * rejected. Does not check gamut or channel ranges, only shape.
 */
export function isValidCssColor(value: string | undefined | null): value is string {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  return CSS_COLOR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function categoryFallback(id = "unknown", name = "Other"): Category {
  return {
    archived: false,
    color: neutralCategoryColor,
    emoji: inferCategoryEmoji(name),
    icon: "circle",
    id,
    name,
    sortOrder: 999
  };
}
