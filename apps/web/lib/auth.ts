export const authCookieName = "af_session";
export const loginPath = "/login";

const bearerPattern = /^Bearer\s+(.+)$/i;
const encoder = new TextEncoder();

export function getConfiguredAuthToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.AI_FINANCES_AUTH_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function getBearerToken(authorizationHeader: string | null): string | undefined {
  const match = authorizationHeader?.match(bearerPattern);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function constantTimeTokenEquals(candidate: string | undefined, expected: string): boolean {
  if (!candidate || expected.length === 0) {
    return false;
  }

  const candidateBytes = encoder.encode(candidate);
  const expectedBytes = encoder.encode(expected);
  const maxLength = Math.max(candidateBytes.length, expectedBytes.length, 1);
  let mismatch = candidateBytes.length ^ expectedBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    const candidateByte = candidateBytes.length === 0 ? 0 : candidateBytes[index % candidateBytes.length];
    const expectedByte = expectedBytes.length === 0 ? 0 : expectedBytes[index % expectedBytes.length];
    mismatch |= candidateByte ^ expectedByte;
  }

  return mismatch === 0;
}
