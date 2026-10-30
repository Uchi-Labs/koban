/**
 * Human-readable security names, resolved from TradingView.
 *
 * Brokerages send their own short names for a security and they are frequently
 * a different company. SnapTrade reported the Roundhill Memory ETF (DRAM) as
 * "DATARAM CP", which is a defunct memory manufacturer that used to hold the
 * ticker; the owner's instruction was to trust TradingView for the display name
 * instead. This resolves the symbol against TradingView's own search index and
 * uses that name when it finds one.
 *
 * Three properties this deliberately has:
 *
 *   - It NEVER invents a name. A miss, a timeout, or a malformed response all
 *     leave the provider's original description in place. That matters here
 *     because the project rule is that provider data stays honest: a wrong name
 *     is a display defect, a fabricated one is a data defect.
 *   - The upstream host is a constant and the symbol only ever travels as a
 *     query parameter, so there is no request-forgery surface. The symbol is
 *     additionally narrowed to a ticker shape before it is used at all.
 *   - It is cached in-process, positives and negatives alike, so a page render
 *     issues at most one request per symbol per TTL rather than one per view.
 */

const SEARCH_ENDPOINT = "https://symbol-search.tradingview.com/symbol_search/v3/";

/** Tickers, including class suffixes (BRK.B) and preferred lines (AGNC-PF). */
const TICKER = /^[A-Za-z0-9][A-Za-z0-9.\-:]{0,19}$/;

const OK_TTL_MS = 24 * 60 * 60 * 1000;
/** Short, so a transient upstream failure does not pin a symbol as unresolvable for a day. */
const MISS_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2500;
/** Bounds a single page render's fan-out; the rest keep their provider names. */
const MAX_LOOKUPS_PER_CALL = 24;

interface CacheEntry {
  description: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
/** Collapses concurrent renders asking for the same symbol into one request. */
const inFlight = new Map<string, Promise<string | null>>();

interface SearchSymbol {
  description?: unknown;
  symbol?: unknown;
  type?: unknown;
}

/**
 * TradingView marks the matched substring with <em> tags, and the symbol field
 * comes back as markup rather than text. Anything with a tag in it is unfit to
 * render, so tags are stripped and the entities TradingView actually emits are
 * decoded.
 */
function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function readString(value: unknown): string {
  return typeof value === "string" ? stripMarkup(value) : "";
}

/**
 * Prefers the row whose ticker is exactly what was asked for.
 *
 * Search is fuzzy, so "DRAM" also returns things merely containing those
 * letters. Taking the first row would sometimes name a holding after a
 * different company, which is the exact failure being fixed. Without an exact
 * ticker match this returns nothing and the provider name stands.
 */
function pickDescription(payload: unknown, symbol: string): string | null {
  const rows = (payload as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(rows)) {
    return null;
  }

  const wanted = symbol.toUpperCase();

  for (const row of rows as SearchSymbol[]) {
    if (readString(row?.symbol).toUpperCase() !== wanted) {
      continue;
    }

    const description = readString(row?.description);
    if (description.length > 0) {
      return description;
    }
  }

  return null;
}

async function fetchDescription(symbol: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SEARCH_ENDPOINT}?text=${encodeURIComponent(symbol)}`, {
      // The endpoint gates on Origin. No credentials and no referrer: this is a
      // public index lookup and nothing about the user should reach it.
      credentials: "omit",
      headers: { Accept: "application/json", Origin: "https://www.tradingview.com" },
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    return pickDescription(await response.json(), symbol);
  } catch {
    // Offline, aborted, or non-JSON. The provider description stands.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Resolves one symbol, or null when there is no confident answer. */
export async function resolveSymbolDescription(symbol: string): Promise<string | null> {
  const trimmed = symbol.trim();
  if (!TICKER.test(trimmed)) {
    return null;
  }

  const key = trimmed.toUpperCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.description;
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const request = fetchDescription(trimmed)
    .then((description) => {
      cache.set(key, {
        description,
        expiresAt: Date.now() + (description === null ? MISS_TTL_MS : OK_TTL_MS)
      });
      return description;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/**
 * Resolves a batch, returning only the symbols that produced a confident name.
 *
 * Symbols already cached cost nothing, so the per-call cap applies to the
 * uncached remainder: a portfolio larger than the cap fills in across renders
 * rather than issuing one burst of requests, and every unresolved holding keeps
 * the name its provider gave it in the meantime.
 */
export async function resolveSymbolDescriptions(symbols: readonly string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const pending: string[] = [];

  for (const symbol of new Set(symbols.map((value) => value.trim()).filter((value) => TICKER.test(value)))) {
    const cached = cache.get(symbol.toUpperCase());
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.description) {
        resolved.set(symbol, cached.description);
      }
      continue;
    }

    pending.push(symbol);
  }

  const results = await Promise.all(
    pending.slice(0, MAX_LOOKUPS_PER_CALL).map(async (symbol) => [symbol, await resolveSymbolDescription(symbol)] as const)
  );

  for (const [symbol, description] of results) {
    if (description) {
      resolved.set(symbol, description);
    }
  }

  return resolved;
}
