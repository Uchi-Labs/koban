import { describe, expect, it } from "vitest";
import {
  iconProxyUrl,
  institutionDomain,
  isIconDomainAllowed,
  merchantBrandColor,
  merchantDomain
} from "@/lib/merchant-domain";

describe("merchant domains", () => {
  it.each([
    ["AIRBNB", "airbnb.com"],
    ["AMZN Marketplace", "amazon.com"],
    ["ANTHROPIC", "anthropic.com"],
    ["APPLE.COM/BILL", "apple.com"],
    ["Apple", "apple.com"],
    ["BROWSERBASE INC", "browserbase.com"],
    ["www.codedex.io", "codedex.io"],
    ["COPILOT MONEY", "copilot.money"],
    ["CURSOR AI POWERED", "cursor.com"],
    ["DISCORD", "discord.com"],
    ["ELEVENLABS", "elevenlabs.io"],
    ["GEICO", "geico.com"],
    ["GOOGLE ONE", "one.google.com"],
    ["HUGGING FACE", "huggingface.co"],
    ["LINKEDIN", "linkedin.com"],
    ["MEDIUM", "medium.com"],
    ["PARKMOBILE", "parkmobile.io"],
    ["RAILWAY", "railway.com"],
    ["SPOTIFY", "spotify.com"],
    ["ADOBE *CREATIVE CLOUD", "adobe.com"],
    ["Apple iCloud+", "apple.com"],
    ["OPENAI *CHATGPT SUBSCR", "chatgpt.com"],
    ["ChatGPT Plus", "chatgpt.com"],
    ["CHEWY INC", "chewy.com"],
    ["COSTCO WHSE #0482", "costco.com"],
    ["CVS/PHARMACY #1234", "cvs.com"],
    ["FIGMA", "figma.com"],
    ["NETFLIX", "netflix.com"],
    ["nytimes.com", "nytimes.com"],
    ["Riverside YMCA", "ymca.org"],
    ["STARBUCKS", "starbucks.com"],
    ["SUPABASE", "supabase.com"],
    ["TORBOX", "torbox.app"],
    ["WALMART", "walmart.com"],
    ["WEBSHARE* RNW PROXY", "webshare.io"],
    ["XSOLLA", "xsolla.com"],
    ["YOUTUBE PREMIUM", "youtube.com"]
  ])("resolves %s to %s", (merchant, domain) => {
    expect(merchantDomain(merchant)).toBe(domain);
  });

  it.each([
    "Apple Valley Diner",
    "Chase Field",
    "Chase Bank",
    "Charles Schwab",
    "Fidelity Investments",
    "Medium Rare Steakhouse",
    "Railway Cafe"
  ])("does not resolve the near-match or institution %s", (merchant) => {
    expect(merchantDomain(merchant)).toBeNull();
  });

  it("provides brand accents only for confidently known merchants", () => {
    expect(merchantBrandColor("SUPABASE")).toBe("#3ecf8e");
    expect(merchantBrandColor("https://www.youtube.com/premium")).toBe("#ff0033");
    expect(merchantBrandColor("Railway Cafe")).toBeNull();
    expect(merchantBrandColor("Mega Limited In")).toBeNull();
  });

  it.each([
    ["Chase Bank", "chase.com"],
    ["Charles Schwab", "schwab.com"],
    ["Fidelity Investments", "fidelity.com"],
    ["Interactive Brokers (Vishhvak Srinivasan)", "interactivebrokers.com"],
    ["Amex Platinum", "americanexpress.com"],
    ["SoFi Checking", "sofi.com"],
    ["Coinbase", "coinbase.com"],
    ["Discover", "discover.com"],
    ["BNY RSU", "bny.com"],
    ["Chase Sapphire Preferred", "chase.com"],
    ["Prime Visa", "chase.com"],
    ["bankofamerica.com", "bankofamerica.com"],
    ["chase.com", "chase.com"],
    ["fidelity.com", "fidelity.com"],
    ["schwab.com", "schwab.com"],
    ["wellsfargo.com", "wellsfargo.com"]
  ])("resolves institution %s to its own brand domain", (institution, expected) => {
    expect(institutionDomain(institution)).toBe(expected);
  });

  it.each(["Some Local Credit Union", "Acme Trust", "unknown-bank.example"])(
    "returns null for unrecognised institution %s rather than guessing",
    (institution) => {
      expect(institutionDomain(institution)).toBeNull();
    }
  );

  /**
   * SEC-03. This replaces an older test that asserted institutionDomain always
   * returned null.
   *
   * The property being protected has not changed: the browser must never reveal
   * which institutions the user banks with to a third party. What changed is
   * where that is enforced. Previously nothing resolved, so nothing could leak.
   * Now institutions resolve and /api/v1/icons fetches the image server-side, so
   * the guarantee lives in the URL handed to the browser.
   *
   * Asserting the guarantee directly is strictly stronger than the old test:
   * that one would have passed even if some other code path had started
   * emitting google.com URLs, because it only ever examined this one function.
   */
  it("only ever gives the browser same-origin icon URLs", () => {
    const domains = [
      institutionDomain("Chase Bank"),
      institutionDomain("Charles Schwab"),
      merchantDomain("AMZN Marketplace"),
      merchantDomain("WALMART.COM")
    ].filter((domain): domain is string => domain !== null);

    expect(domains.length).toBeGreaterThan(0);

    for (const domain of domains) {
      const url = iconProxyUrl(domain);
      expect(url.startsWith("/api/v1/icons/")).toBe(true);
      expect(url).not.toMatch(/^https?:\/\//);
      expect(url).not.toMatch(/google\.com|gstatic\.com|duckduckgo\.com/);
    }
  });

  it("refuses to proxy a domain that is not in the vetted tables", () => {
    expect(isIconDomainAllowed("chase.com")).toBe(true);
    expect(isIconDomainAllowed("walmart.com")).toBe(true);
    // Free-text domains are deliberately excluded: the proxy serves only marks
    // that have been vetted into the tables.
    expect(isIconDomainAllowed("attacker.example")).toBe(false);
    expect(isIconDomainAllowed("localhost")).toBe(false);
  });
});
