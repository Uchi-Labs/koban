const DOMAIN_IN_TEXT = /\b(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:ai|app|co|com|dev|io|money|net|org))\b/i;

const KNOWN_MERCHANT_DOMAINS: Array<{
  accentColor?: string;
  domain: string;
  pattern: RegExp;
  validate?: (merchant: string) => boolean;
}> = [
  { accentColor: "#ff385c", domain: "airbnb.com", pattern: /\bairbnb\b/i },
  { accentColor: "#ff9900", domain: "amazon.com", pattern: /\b(?:amazon|amzn)\b/i },
  { accentColor: "#da1f26", domain: "adobe.com", pattern: /\badobe\b/i },
  { accentColor: "#d4a574", domain: "anthropic.com", pattern: /\banthropic\b/i },
  {
    accentColor: "#a3a3a3",
    domain: "apple.com",
    pattern: /\bapple\b/i,
    validate: (merchant) => merchant === "apple" || /^apple(?:[./]|\s+(?:bill|com|icloud|one|music|tv)\b)/i.test(merchant)
  },
  // Deliberately NO bank/brokerage domains here: institution names resolved to
  // third-party favicon URLs (google/ddg) would leak which institutions the
  // user banks with from their own browser (SEC-03). Institutions fall back to
  // the tinted icon in account-favicon-badge.tsx. Restore bank logos only via
  // a same-origin favicon proxy if ever wanted.
  { accentColor: "#60a5fa", domain: "browserbase.com", pattern: /\bbrowserbase\b/i },
  { accentColor: "#10a37f", domain: "chatgpt.com", pattern: /\bchatgpt\b/i },
  { accentColor: "#1c49c2", domain: "chewy.com", pattern: /\bchewy\b/i },
  { accentColor: "#facc15", domain: "codedex.io", pattern: /\bcode\s*dex\b|\bcodedex\b/i },
  { accentColor: "#60a5fa", domain: "copilot.money", pattern: /\bcopilot money\b/i },
  { accentColor: "#e31837", domain: "costco.com", pattern: /\bcostco\b/i },
  {
    accentColor: "#d1d5db",
    domain: "cursor.com",
    pattern: /\bcursor\b/i,
    validate: (merchant) => merchant === "cursor" || /^cursor\s+ai\b/i.test(merchant)
  },
  { accentColor: "#cc0000", domain: "cvs.com", pattern: /\bcvs\b/i },
  { accentColor: "#5865f2", domain: "discord.com", pattern: /\bdiscord\b/i },
  { accentColor: "#d4a574", domain: "elevenlabs.io", pattern: /\belevenlabs?\b/i },
  { accentColor: "#a259ff", domain: "figma.com", pattern: /\bfigma\b/i },
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
  { accentColor: "#e50914", domain: "netflix.com", pattern: /\bnetflix\b/i },
  { accentColor: "#d1d5db", domain: "nytimes.com", pattern: /\b(?:nytimes|new york times)\b/i },
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
  { accentColor: "#5c2d91", domain: "ymca.org", pattern: /\bymca\b/i },
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

/**
 * Banks and brokerages, resolved the same way merchants are.
 *
 * These were deliberately absent while favicons were fetched straight from
 * google/ddg by the browser, because the request set leaked the user's whole
 * banking roster to a third party from their own IP (SEC-03). They are safe
 * again now that /api/v1/icons serves every favicon from this origin: the
 * browser only ever talks to us. See app/api/v1/icons/[domain]/route.ts.
 *
 * Ordered so that a co-brand card matches its issuer before a generic word in
 * its name can match something else.
 */
const KNOWN_INSTITUTION_DOMAINS: Array<{ domain: string; pattern: RegExp }> = [
  { domain: "americanexpress.com", pattern: /\b(?:american ?express|amex)\b/i },
  { domain: "bny.com", pattern: /\bbny\b|\bbank ?of ?new ?york\b/i },
  { domain: "coinbase.com", pattern: /\bcoinbase\b/i },
  { domain: "discover.com", pattern: /\bdiscover\b/i },
  { domain: "fidelity.com", pattern: /\bfidelity\b/i },
  { domain: "interactivebrokers.com", pattern: /\binteractive ?brokers\b|\bibkr\b/i },
  { domain: "schwab.com", pattern: /\bschwab\b/i },
  { domain: "sofi.com", pattern: /\bsofi\b/i },
  // Chase last of the issuers: "Prime Visa" and "Sapphire" are Chase products
  // whose names do not contain the word, so they are matched explicitly.
  { domain: "chase.com", pattern: /\bchase\b|\bsapphire\b|\bprime ?visa\b|\bfreedom ?(?:unlimited|flex)\b/i },
  { domain: "ally.com", pattern: /\bally\b/i },
  { domain: "bankofamerica.com", pattern: /\bbank ?of ?america\b|\bbofa\b/i },
  { domain: "capitalone.com", pattern: /\bcapital ?one\b/i },
  { domain: "citi.com", pattern: /\bcitibank\b|\bciti\b/i },
  { domain: "robinhood.com", pattern: /\brobinhood\b/i },
  { domain: "usbank.com", pattern: /\bu\.?s\.? ?bank\b/i },
  { domain: "vanguard.com", pattern: /\bvanguard\b/i },
  { domain: "wellsfargo.com", pattern: /\bwells ?fargo\b/i }
];

/**
 * The URL the browser is given for a brand icon.
 *
 * Lives here rather than in the badge component because it is the point where
 * the SEC-03 guarantee is actually made: whatever this returns is what the
 * browser requests. Keeping it beside the allowlist means the guarantee and its
 * limits are reviewed together, and lets a plain unit test assert it without
 * importing a client component.
 */
export function iconProxyUrl(domain: string): string {
  return `/api/v1/icons/${encodeURIComponent(domain)}`;
}

/**
 * Returns a real institution domain only for confidently known institutions.
 *
 * Unmatched institutions return null and keep the tinted fallback icon in
 * account-favicon-badge.tsx rather than borrowing some other brand's logo.
 */
export function institutionDomain(institution: string): string | null {
  const normalized = normalizeMerchant(institution);

  return KNOWN_INSTITUTION_DOMAINS.find(({ pattern }) => pattern.test(normalized))?.domain ?? null;
}

/**
 * Every domain the icon proxy will fetch. The route refuses anything else, so
 * an authenticated caller cannot turn it into a general-purpose image fetcher.
 *
 * A merchant whose domain came out of free text (the DOMAIN_IN_TEXT branch of
 * merchantDomain) is deliberately NOT in here. Such a merchant keeps its brand
 * colour and simply falls back to its letter avatar until someone adds it to
 * KNOWN_MERCHANT_DOMAINS, which is the honest outcome: we only serve a logo we
 * have actually vetted.
 */
export function isIconDomainAllowed(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");

  return (
    KNOWN_MERCHANT_DOMAINS.some((entry) => entry.domain === normalized) ||
    KNOWN_INSTITUTION_DOMAINS.some((entry) => entry.domain === normalized)
  );
}
