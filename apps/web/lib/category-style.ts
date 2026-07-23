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

export interface FinanceEmojiOption {
  emoji: string;
  keywords: readonly string[];
}

export const financeEmojiSearchOptions = [
  { emoji: "🏷️", keywords: ["category", "label", "other"] },
  { emoji: "💵", keywords: ["cash", "income", "salary", "paycheck"] },
  { emoji: "💳", keywords: ["card", "credit", "payment", "debit"] },
  { emoji: "🧾", keywords: ["receipt", "bill", "expense", "invoice"] },
  { emoji: "🏦", keywords: ["bank", "checking", "account", "finance"] },
  { emoji: "📈", keywords: ["investment", "stocks", "growth", "profit"] },
  { emoji: "📉", keywords: ["loss", "decline", "market", "investment"] },
  { emoji: "💰", keywords: ["money", "savings", "wealth", "budget"] },
  { emoji: "🪙", keywords: ["coin", "crypto", "change", "currency"] },
  { emoji: "💸", keywords: ["spending", "expense", "cash", "money"] },
  { emoji: "🔁", keywords: ["transfer", "recurring", "exchange", "repeat"] },
  { emoji: "📤", keywords: ["sent", "outgoing", "withdrawal", "transfer"] },
  { emoji: "📥", keywords: ["received", "incoming", "deposit", "transfer"] },
  { emoji: "🛒", keywords: ["groceries", "supermarket", "food", "shopping"] },
  { emoji: "🛍️", keywords: ["shopping", "retail", "clothes", "store"] },
  { emoji: "🎁", keywords: ["gift", "present", "birthday", "holiday"] },
  { emoji: "🍽️", keywords: ["restaurant", "dining", "meal", "food"] },
  { emoji: "🍔", keywords: ["fast food", "burger", "takeout", "lunch"] },
  { emoji: "🍕", keywords: ["pizza", "takeout", "delivery", "food"] },
  { emoji: "☕", keywords: ["coffee", "cafe", "tea", "breakfast"] },
  { emoji: "🍺", keywords: ["beer", "bar", "drinks", "nightlife"] },
  { emoji: "🍷", keywords: ["wine", "drinks", "bar", "dining"] },
  { emoji: "🥗", keywords: ["salad", "healthy", "lunch", "food"] },
  { emoji: "🥐", keywords: ["bakery", "breakfast", "pastry", "cafe"] },
  { emoji: "🍎", keywords: ["produce", "fruit", "groceries", "food"] },
  { emoji: "🥩", keywords: ["meat", "butcher", "groceries", "food"] },
  { emoji: "🍰", keywords: ["dessert", "bakery", "cake", "celebration"] },
  { emoji: "🧋", keywords: ["boba", "tea", "cafe", "drinks"] },
  { emoji: "🚗", keywords: ["car", "auto", "transportation", "commute"] },
  { emoji: "⛽", keywords: ["gas", "fuel", "petrol", "car"] },
  { emoji: "🚌", keywords: ["bus", "transit", "commute", "transportation"] },
  { emoji: "🚇", keywords: ["subway", "metro", "train", "transit"] },
  { emoji: "🚕", keywords: ["taxi", "rideshare", "uber", "lyft"] },
  { emoji: "🚲", keywords: ["bike", "cycling", "commute", "rental"] },
  { emoji: "🅿️", keywords: ["parking", "garage", "car", "meter"] },
  { emoji: "🚙", keywords: ["vehicle", "suv", "auto", "car"] },
  { emoji: "🛣️", keywords: ["toll", "road", "highway", "travel"] },
  { emoji: "✈️", keywords: ["flight", "airline", "travel", "vacation"] },
  { emoji: "🏨", keywords: ["hotel", "lodging", "stay", "travel"] },
  { emoji: "🧳", keywords: ["trip", "luggage", "vacation", "travel"] },
  { emoji: "🚢", keywords: ["cruise", "boat", "travel", "vacation"] },
  { emoji: "🏖️", keywords: ["beach", "vacation", "holiday", "travel"] },
  { emoji: "🗺️", keywords: ["map", "trip", "tourism", "travel"] },
  { emoji: "⛺", keywords: ["camping", "outdoors", "trip", "vacation"] },
  { emoji: "🏠", keywords: ["rent", "mortgage", "housing", "home"] },
  { emoji: "🏡", keywords: ["house", "property", "garden", "home"] },
  { emoji: "🔑", keywords: ["rent", "lease", "property", "home"] },
  { emoji: "🛠️", keywords: ["repair", "maintenance", "tools", "home"] },
  { emoji: "🧰", keywords: ["contractor", "repair", "maintenance", "tools"] },
  { emoji: "🧱", keywords: ["renovation", "construction", "materials", "home"] },
  { emoji: "🚿", keywords: ["bathroom", "plumbing", "water", "home"] },
  { emoji: "🛋️", keywords: ["furniture", "living room", "decor", "home"] },
  { emoji: "🪑", keywords: ["furniture", "chair", "office", "home"] },
  { emoji: "💡", keywords: ["electricity", "power", "utilities", "energy"] },
  { emoji: "💧", keywords: ["water", "utility", "plumbing", "bill"] },
  { emoji: "🔥", keywords: ["gas", "heating", "utility", "energy"] },
  { emoji: "🔌", keywords: ["electric", "charging", "utility", "power"] },
  { emoji: "📱", keywords: ["phone", "mobile", "cellular", "technology"] },
  { emoji: "💻", keywords: ["computer", "software", "subscription", "technology"] },
  { emoji: "🖥️", keywords: ["desktop", "monitor", "electronics", "technology"] },
  { emoji: "🌐", keywords: ["internet", "web", "hosting", "online"] },
  { emoji: "🔐", keywords: ["security", "password", "vpn", "software"] },
  { emoji: "🧑‍💻", keywords: ["developer", "coding", "software", "work"] },
  { emoji: "🎮", keywords: ["games", "gaming", "console", "entertainment"] },
  { emoji: "🎬", keywords: ["movie", "cinema", "streaming", "entertainment"] },
  { emoji: "🎧", keywords: ["music", "audio", "podcast", "entertainment"] },
  { emoji: "🎟️", keywords: ["tickets", "event", "concert", "entertainment"] },
  { emoji: "🎨", keywords: ["art", "craft", "hobby", "supplies"] },
  { emoji: "📚", keywords: ["books", "reading", "education", "school"] },
  { emoji: "📺", keywords: ["television", "streaming", "cable", "entertainment"] },
  { emoji: "🎵", keywords: ["music", "subscription", "concert", "audio"] },
  { emoji: "📰", keywords: ["news", "newspaper", "subscription", "media"] },
  { emoji: "🏥", keywords: ["hospital", "medical", "healthcare", "emergency"] },
  { emoji: "💊", keywords: ["pharmacy", "medicine", "prescription", "health"] },
  { emoji: "🩺", keywords: ["doctor", "clinic", "checkup", "medical"] },
  { emoji: "🧘", keywords: ["wellness", "yoga", "meditation", "health"] },
  { emoji: "🏋️", keywords: ["gym", "fitness", "workout", "health"] },
  { emoji: "🏃", keywords: ["running", "fitness", "race", "exercise"] },
  { emoji: "🧴", keywords: ["skincare", "toiletries", "personal care", "beauty"] },
  { emoji: "🐾", keywords: ["pet", "veterinary", "animal", "supplies"] },
  { emoji: "🐕", keywords: ["dog", "pet", "grooming", "veterinary"] },
  { emoji: "👕", keywords: ["clothing", "shirt", "fashion", "shopping"] },
  { emoji: "👟", keywords: ["shoes", "sneakers", "clothing", "shopping"] },
  { emoji: "💄", keywords: ["makeup", "beauty", "cosmetics", "personal care"] },
  { emoji: "✂️", keywords: ["haircut", "salon", "grooming", "personal care"] },
  { emoji: "👶", keywords: ["baby", "child", "daycare", "family"] },
  { emoji: "🧸", keywords: ["toys", "kids", "child", "family"] },
  { emoji: "🎓", keywords: ["tuition", "college", "education", "school"] },
  { emoji: "🏫", keywords: ["school", "education", "tuition", "kids"] },
  { emoji: "💼", keywords: ["business", "work", "office", "professional"] },
  { emoji: "🧑‍💼", keywords: ["career", "employee", "business", "work"] },
  { emoji: "📝", keywords: ["office", "writing", "supplies", "work"] },
  { emoji: "📦", keywords: ["shipping", "package", "delivery", "order"] },
  { emoji: "📬", keywords: ["mail", "postage", "shipping", "delivery"] },
  { emoji: "🧹", keywords: ["cleaning", "housekeeping", "home", "service"] },
  { emoji: "🧺", keywords: ["laundry", "cleaning", "clothes", "service"] },
  { emoji: "🛡️", keywords: ["insurance", "protection", "warranty", "security"] },
  { emoji: "📄", keywords: ["tax", "document", "fee", "paperwork"] },
  { emoji: "⚖️", keywords: ["legal", "lawyer", "court", "fees"] },
  { emoji: "🧮", keywords: ["accounting", "bookkeeping", "tax", "finance"] },
  { emoji: "🏛️", keywords: ["government", "tax", "civic", "fees"] },
  { emoji: "🎯", keywords: ["goal", "budget", "target", "savings"] },
  { emoji: "❤️", keywords: ["charity", "donation", "love", "giving"] },
  { emoji: "🤝", keywords: ["charity", "donation", "partnership", "giving"] },
  { emoji: "🌱", keywords: ["garden", "plants", "sustainable", "growth"] }
] as const satisfies readonly FinanceEmojiOption[];

export const financeEmojiOptions = financeEmojiSearchOptions.map(({ emoji }) => emoji);

function normalizeEmojiSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
}

export function filterFinanceEmojiOptions(
  query: string,
  options: readonly FinanceEmojiOption[] = financeEmojiSearchOptions
): FinanceEmojiOption[] {
  const terms = normalizeEmojiSearchText(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return [...options];
  }

  return options.filter(({ emoji, keywords }) => {
    const searchable = normalizeEmojiSearchText(`${emoji} ${keywords.join(" ")}`);
    return terms.every((term) => searchable.includes(term));
  });
}

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
