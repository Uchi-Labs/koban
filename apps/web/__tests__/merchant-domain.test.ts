import { describe, expect, it } from "vitest";
import { institutionDomain, merchantDomain } from "@/lib/merchant-domain";

describe("merchant domains", () => {
  it.each([
    ["AIRBNB", "airbnb.com"],
    ["AMZN Marketplace", "amazon.com"],
    ["ANTHROPIC", "anthropic.com"],
    ["APPLE.COM/BILL", "apple.com"],
    ["Apple", "apple.com"],
    ["COPILOT MONEY", "copilot.money"],
    ["CURSOR AI POWERED", "cursor.com"],
    ["DISCORD", "discord.com"],
    ["ELEVENLABS", "elevenlabs.io"],
    ["HUGGING FACE", "huggingface.co"],
    ["LINKEDIN", "linkedin.com"],
    ["STARBUCKS", "starbucks.com"],
    ["TORBOX", "torbox.app"],
    ["WALMART", "walmart.com"]
  ])("resolves %s to %s", (merchant, domain) => {
    expect(merchantDomain(merchant)).toBe(domain);
  });

  it.each([
    "Apple Valley Diner",
    "Chase Field",
    "Chase Bank",
    "Charles Schwab",
    "Fidelity Investments"
  ])("does not resolve the near-match or institution %s", (merchant) => {
    expect(merchantDomain(merchant)).toBeNull();
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
