import { describe, expect, it } from "vitest";
import { institutionDomain, merchantBrandColor, merchantDomain } from "@/lib/merchant-domain";

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
    "Chase Bank",
    "Charles Schwab",
    "Fidelity Investments",
    "bankofamerica.com",
    "chase.com",
    "fidelity.com",
    "schwab.com",
    "wellsfargo.com"
  ])("never resolves institution identity %s", (institution) => {
    expect(institutionDomain(institution)).toBeNull();
  });
});
