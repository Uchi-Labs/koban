import { createHash, timingSafeEqual } from "node:crypto";

export function timingSafeTokenEquals(candidate: string | undefined, expected: string): boolean {
  if (!candidate || expected.length === 0) {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const candidateDigest = createHash("sha256").update(candidateBuffer).digest();
  const expectedDigest = createHash("sha256").update(expectedBuffer).digest();

  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateDigest, expectedDigest);
}
