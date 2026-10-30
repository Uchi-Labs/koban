import { describe, expect, it } from "vitest";
import { resolveTrustedOrigins } from "@/lib/auth";

describe("resolveTrustedOrigins", () => {
  it("trusts both loopback spellings on any port when no base URL is configured", () => {
    // The failure this guards: an unset BETTER_AUTH_URL left Better Auth with
    // no trusted origin at all, so every sign-in POST returned "Invalid origin".
    const origins = resolveTrustedOrigins({});

    expect(origins).toContain("http://localhost:*");
    expect(origins).toContain("http://127.0.0.1:*");
  });

  it("keeps loopback trusted when a base URL names only one spelling", () => {
    // Running on 127.0.0.1 while BETTER_AUTH_URL says localhost is the same
    // machine but a different origin to the browser.
    const origins = resolveTrustedOrigins({ BETTER_AUTH_URL: "http://localhost:3007" });

    expect(origins).toContain("http://localhost:3007");
    expect(origins).toContain("http://127.0.0.1:*");
  });

  it("adds the deployed origin and any explicitly configured hosts", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_TRUSTED_ORIGINS: "https://staging.koban.app , https://alt.koban.app",
      BETTER_AUTH_URL: "https://koban.app/some/path"
    });

    expect(origins).toContain("https://koban.app");
    expect(origins).toContain("https://staging.koban.app");
    expect(origins).toContain("https://alt.koban.app");
  });

  it("survives a malformed base URL without losing loopback", () => {
    const origins = resolveTrustedOrigins({ BETTER_AUTH_URL: "not a url" });

    expect(origins).toContain("http://127.0.0.1:*");
  });

  it("never trusts a wildcard host", () => {
    const origins = resolveTrustedOrigins({ BETTER_AUTH_URL: "https://koban.app" });

    for (const origin of origins) {
      expect(origin).not.toBe("*");
      expect(origin.startsWith("*")).toBe(false);
    }
  });
});
