const DOMAIN_IN_TEXT = /\b(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:ai|app|co|com|dev|io|money|net|org))\b/i;

const KNOWN_MERCHANT_DOMAINS: Array<{
  domain: string;
  pattern: RegExp;
  validate?: (merchant: string) => boolean;
}> = [
  { domain: "airbnb.com", pattern: /\bairbnb\b/i },
  { domain: "amazon.com", pattern: /\b(?:amazon|amzn)\b/i },
  { domain: "anthropic.com", pattern: /\banthropic\b/i },
  {
    domain: "apple.com",
    pattern: /\bapple\b/i,
    validate: (merchant) => merchant === "apple" || /^apple(?:[./]|\s+(?:bill|com)\b)/i.test(merchant)
  },
  // Deliberately NO bank/brokerage domains here: institution names resolved to
  // third-party favicon URLs (google/ddg) would leak which institutions the
  // user banks with from their own browser (SEC-03). Institutions fall back to
  // the tinted icon in account-favicon-badge.tsx. Restore bank logos only via
  // a same-origin favicon proxy if ever wanted.
  { domain: "copilot.money", pattern: /\bcopilot money\b/i },
  {
    domain: "cursor.com",
    pattern: /\bcursor\b/i,
    validate: (merchant) => merchant === "cursor" || /^cursor\s+ai\b/i.test(merchant)
  },
  { domain: "discord.com", pattern: /\bdiscord\b/i },
  { domain: "elevenlabs.io", pattern: /\belevenlabs?\b/i },
  { domain: "huggingface.co", pattern: /\bhugging face\b/i },
  { domain: "linkedin.com", pattern: /\blinkedin\b/i },
  { domain: "starbucks.com", pattern: /\bstarbucks\b/i },
  { domain: "torbox.app", pattern: /\btorbox\b/i },
  { domain: "walmart.com", pattern: /\bwalmart\b/i }
];

/** Returns a real merchant domain only when it is explicit or confidently known. */
export function merchantDomain(merchant: string): string | null {
  const directDomain = merchant.match(DOMAIN_IN_TEXT)?.[1];

  if (directDomain) {
    return directDomain.toLowerCase();
  }

  const normalizedMerchant = merchant.trim().replace(/^[^a-z0-9]+/i, "").toLowerCase();
  const match = KNOWN_MERCHANT_DOMAINS.find(({ pattern, validate }) => {
    return pattern.test(normalizedMerchant) && (validate?.(normalizedMerchant) ?? true);
  });

  return match?.domain ?? null;
}

/** Institution names never resolve to third-party favicon requests. */
export function institutionDomain(_institution: string): string | null {
  return null;
}
