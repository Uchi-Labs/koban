const DOMAIN_IN_TEXT = /\b(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:ai|app|co|com|dev|io|money|net|org))\b/i;

const KNOWN_MERCHANT_DOMAINS: Array<{
  accentColor?: string;
  domain: string;
  pattern: RegExp;
  validate?: (merchant: string) => boolean;
}> = [
  { accentColor: "#ff385c", domain: "airbnb.com", pattern: /\bairbnb\b/i },
  { accentColor: "#ff9900", domain: "amazon.com", pattern: /\b(?:amazon|amzn)\b/i },
  { accentColor: "#d4a574", domain: "anthropic.com", pattern: /\banthropic\b/i },
  {
    accentColor: "#a3a3a3",
    domain: "apple.com",
    pattern: /\bapple\b/i,
    validate: (merchant) => merchant === "apple" || /^apple(?:[./]|\s+(?:bill|com)\b)/i.test(merchant)
  },
  // Deliberately NO bank/brokerage domains here: institution names resolved to
  // third-party favicon URLs (google/ddg) would leak which institutions the
  // user banks with from their own browser (SEC-03). Institutions fall back to
  // the tinted icon in account-favicon-badge.tsx. Restore bank logos only via
  // a same-origin favicon proxy if ever wanted.
  { accentColor: "#60a5fa", domain: "browserbase.com", pattern: /\bbrowserbase\b/i },
  { accentColor: "#facc15", domain: "codedex.io", pattern: /\bcode\s*dex\b|\bcodedex\b/i },
  { accentColor: "#60a5fa", domain: "copilot.money", pattern: /\bcopilot money\b/i },
  {
    accentColor: "#d1d5db",
    domain: "cursor.com",
    pattern: /\bcursor\b/i,
    validate: (merchant) => merchant === "cursor" || /^cursor\s+ai\b/i.test(merchant)
  },
  { accentColor: "#5865f2", domain: "discord.com", pattern: /\bdiscord\b/i },
  { accentColor: "#d4a574", domain: "elevenlabs.io", pattern: /\belevenlabs?\b/i },
  { accentColor: "#2565a8", domain: "geico.com", pattern: /\bgeico\b/i },
  { accentColor: "#4285f4", domain: "one.google.com", pattern: /\bgoogle one\b/i },
  { accentColor: "#f6c344", domain: "huggingface.co", pattern: /\bhugging face\b/i },
  { accentColor: "#0a66c2", domain: "linkedin.com", pattern: /\blinkedin\b/i },
  {
    accentColor: "#d1d5db",
    domain: "medium.com",
    pattern: /\bmedium\b/i,
    validate: (merchant) => merchant === "medium" || /^medium(?:\.com|\s+(?:membership|subscription))\b/i.test(merchant)
  },
  { accentColor: "#d81b60", domain: "parkmobile.io", pattern: /\bparkmobile\b/i },
  {
    accentColor: "#a855f7",
    domain: "railway.com",
    pattern: /\brailway\b/i,
    validate: (merchant) => merchant === "railway" || /^railway(?:\.com|\s+(?:app|cloud|subscription))\b/i.test(merchant)
  },
  { accentColor: "#1ed760", domain: "spotify.com", pattern: /\bspotify\b/i },
  { accentColor: "#00754a", domain: "starbucks.com", pattern: /\bstarbucks\b/i },
  { accentColor: "#3ecf8e", domain: "supabase.com", pattern: /\bsupabase\b/i },
  { accentColor: "#7c3aed", domain: "torbox.app", pattern: /\btorbox\b/i },
  { accentColor: "#34d399", domain: "webshare.io", pattern: /\bwebshare\b/i },
  { accentColor: "#0071ce", domain: "walmart.com", pattern: /\bwalmart\b/i },
  { accentColor: "#d1d5db", domain: "xsolla.com", pattern: /\bxsolla\b/i },
  { accentColor: "#ff0033", domain: "youtube.com", pattern: /\byoutube(?:\s+premium)?\b/i }
];

function normalizeMerchant(merchant: string) {
  return merchant.trim().replace(/^[^a-z0-9]+/i, "").toLowerCase();
}

function knownMerchant(merchant: string, directDomain?: string | null) {
  const normalizedMerchant = normalizeMerchant(merchant);

  return KNOWN_MERCHANT_DOMAINS.find(({ domain, pattern, validate }) => {
    if (directDomain === domain || directDomain?.endsWith(`.${domain}`)) {
      return true;
    }

    return pattern.test(normalizedMerchant) && (validate?.(normalizedMerchant) ?? true);
  });
}

/** Returns a real merchant domain only when it is explicit or confidently known. */
export function merchantDomain(merchant: string): string | null {
  const directDomain = merchant.match(DOMAIN_IN_TEXT)?.[1];

  if (directDomain) {
    return directDomain.toLowerCase();
  }

  return knownMerchant(merchant)?.domain ?? null;
}

/** Returns a restrained visual accent for confidently known merchant brands. */
export function merchantBrandColor(merchant: string): string | null {
  const directDomain = merchant.match(DOMAIN_IN_TEXT)?.[1]?.toLowerCase() ?? null;
  return knownMerchant(merchant, directDomain)?.accentColor ?? null;
}

/** Institution names never resolve to third-party favicon requests. */
export function institutionDomain(_institution: string): string | null {
  return null;
}
