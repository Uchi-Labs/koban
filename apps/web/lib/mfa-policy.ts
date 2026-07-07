export interface PasswordSignInMfaEnrollment {
  hasPasskey: boolean;
  hasVerifiedTotp: boolean;
}

export interface PasswordSignInMfaDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluatePasswordSignInMfaPolicy(
  enrollment: PasswordSignInMfaEnrollment
): PasswordSignInMfaDecision {
  if (enrollment.hasVerifiedTotp) {
    return { allowed: true };
  }

  if (enrollment.hasPasskey) {
    return {
      allowed: false,
      reason: "Use passkey sign in for this Koban account."
    };
  }

  return { allowed: true };
}

export function passkeySignInSatisfiesMfa(enrollment: Pick<PasswordSignInMfaEnrollment, "hasPasskey">): boolean {
  return enrollment.hasPasskey;
}
