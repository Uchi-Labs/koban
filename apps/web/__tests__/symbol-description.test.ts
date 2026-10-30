import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSymbolDescription, resolveSymbolDescriptions } from "@/lib/symbol-description";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The real shape, captured from the live endpoint: a fuzzy search returns many
 * rows carrying the SAME ticker on different exchanges, plus rows that merely
 * contain the letters. The US listing is the one wanted, and TradingView marks
 * the matched substring with <em> tags in both fields.
 */
function searchResponse(rows: Array<{ description: string; symbol: string }>) {
  return {
    json: async () => ({ symbols: rows }),
    ok: true
  };
}

/** Each symbol is looked up at most once per TTL, so tests must not collide. */
let unique = 0;
function freshSymbol(prefix = "TST") {
  unique += 1;
  return `${prefix}${unique}`;
}

describe("resolveSymbolDescription", () => {
  it("returns the exact ticker match, not the first row", async () => {
    const symbol = freshSymbol("DRAM");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        searchResponse([
          { description: "Something Else Entirely", symbol: "DRAMX" },
          { description: "Roundhill Memory ETF", symbol: symbol },
          { description: "Defiance Memory UCITS ETF", symbol: symbol }
        ])
      )
    );

    expect(await resolveSymbolDescription(symbol)).toBe("Roundhill Memory ETF");
  });

  it("strips the <em> highlight markup TradingView emits", async () => {
    const symbol = freshSymbol();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        searchResponse([{ description: "Roundhill <em>Memory</em> ETF &amp; Co", symbol: `<em>${symbol}</em>` }])
      )
    );

    expect(await resolveSymbolDescription(symbol)).toBe("Roundhill Memory ETF & Co");
  });

  it("returns null when no row matches the ticker exactly, rather than guessing", async () => {
    const symbol = freshSymbol();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => searchResponse([{ description: "A Different Company", symbol: `${symbol}X` }]))
    );

    expect(await resolveSymbolDescription(symbol)).toBeNull();
  });

  it("returns null on an upstream failure, so the provider name survives", async () => {
    const symbol = freshSymbol();
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}), ok: false })));

    expect(await resolveSymbolDescription(symbol)).toBeNull();
  });

  it("returns null when the request throws, and does not propagate", async () => {
    const symbol = freshSymbol();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );

    await expect(resolveSymbolDescription(symbol)).resolves.toBeNull();
  });

  it.each(["", "  ", "not a ticker", "../../etc/passwd", "https://evil.example", "A".repeat(64)])(
    "never issues a request for a non-ticker input (%j)",
    async (input) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      expect(await resolveSymbolDescription(input)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("sends the symbol as an encoded query parameter to the fixed upstream host", async () => {
    const symbol = freshSymbol("BRK.B");
    const fetchMock = vi.fn(async () => searchResponse([{ description: "Berkshire", symbol }]));
    vi.stubGlobal("fetch", fetchMock);

    await resolveSymbolDescription(symbol);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://symbol-search.tradingview.com/symbol_search/v3/?text=")).toBe(true);
    expect(url).toContain(encodeURIComponent(symbol));
    // No user data reaches a third party.
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("caches a hit so a repeat lookup issues no second request", async () => {
    const symbol = freshSymbol();
    const fetchMock = vi.fn(async () => searchResponse([{ description: "Cached Co", symbol }]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveSymbolDescription(symbol)).toBe("Cached Co");
    expect(await resolveSymbolDescription(symbol)).toBe("Cached Co");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent lookups of the same symbol into one request", async () => {
    const symbol = freshSymbol();
    const fetchMock = vi.fn(async () => searchResponse([{ description: "Once Only", symbol }]));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b, c] = await Promise.all([
      resolveSymbolDescription(symbol),
      resolveSymbolDescription(symbol),
      resolveSymbolDescription(symbol)
    ]);

    expect([a, b, c]).toEqual(["Once Only", "Once Only", "Once Only"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveSymbolDescriptions", () => {
  it("omits symbols it could not resolve, so callers fall back per holding", async () => {
    const good = freshSymbol("GOOD");
    const bad = freshSymbol("BAD");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes(good)
          ? searchResponse([{ description: "Good Corp", symbol: good }])
          : searchResponse([{ description: "Mismatch", symbol: `${bad}X` }])
      )
    );

    const resolved = await resolveSymbolDescriptions([good, bad]);

    expect(resolved.get(good)).toBe("Good Corp");
    expect(resolved.has(bad)).toBe(false);
  });

  it("deduplicates repeated symbols into a single request", async () => {
    const symbol = freshSymbol();
    const fetchMock = vi.fn(async () => searchResponse([{ description: "One Request", symbol }]));
    vi.stubGlobal("fetch", fetchMock);

    await resolveSymbolDescriptions([symbol, symbol, symbol]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips non-ticker entries without failing the batch", async () => {
    const symbol = freshSymbol();
    const fetchMock = vi.fn(async () => searchResponse([{ description: "Survivor", symbol }]));
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveSymbolDescriptions([symbol, "", "not a ticker"]);

    expect(resolved.get(symbol)).toBe("Survivor");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
