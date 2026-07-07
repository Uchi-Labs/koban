import { describe, expect, it } from "vitest";
import { evaluatePasswordSignInMfaPolicy, passkeySignInSatisfiesMfa } from "@/lib/mfa-policy";

describe("MFA policy", () => {
  it("allows password sign-in when no MFA method is enrolled", () => {
    expect(evaluatePasswordSignInMfaPolicy({ hasPasskey: false, hasVerifiedTotp: false })).toEqual({
      allowed: true
    });
  });

  it("allows password sign-in to continue into Better Auth's TOTP challenge", () => {
    expect(evaluatePasswordSignInMfaPolicy({ hasPasskey: true, hasVerifiedTotp: true })).toEqual({
      allowed: true
    });
  });

  it("blocks password-only sign-in when the account only has a passkey enrolled", () => {
    expect(evaluatePasswordSignInMfaPolicy({ hasPasskey: true, hasVerifiedTotp: false })).toEqual({
      allowed: false,
      reason: "Use passkey sign in for this Koban account."
    });
  });

  it("treats passkey sign-in as satisfying MFA only when a passkey exists", () => {
    expect(passkeySignInSatisfiesMfa({ hasPasskey: true })).toBe(true);
    expect(passkeySignInSatisfiesMfa({ hasPasskey: false })).toBe(false);
  });
});
