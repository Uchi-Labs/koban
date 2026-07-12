const DOMAIN_IN_TEXT = /\b(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:ai|app|co|com|dev|io|money|net|org))\b/i;

const KNOWN_MERCHANT_DOMAINS: Array<{ domain: string; pattern: RegExp }> = [
  { domain: "airbnb.com", pattern: /\bairbnb\b/i },
  { domain: "amazon.com", pattern: /\b(?:amazon|amzn)\b/i },
  { domain: "anthropic.com", pattern: /\banthropic\b/i },
  { domain: "apple.com", pattern: /\bapple\b/i },
  { domain: "copilot.money", pattern: /\bcopilot money\b/i },
  { domain: "cursor.com", pattern: /\bcursor\b/i },
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

  return KNOWN_MERCHANT_DOMAINS.find(({ pattern }) => pattern.test(merchant))?.domain ?? null;
}
