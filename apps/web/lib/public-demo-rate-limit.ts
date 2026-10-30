// Every demo question spends the owner's model quota, so the public demo caps
// questions per visitor address and across all visitors. Counters live in this
// process; the demo runs as one Railway instance, and a restart only resets them.

const visitorLimit = { max: 12, windowMs: 60 * 60_000 };
const globalLimit = { max: 400, windowMs: 24 * 60 * 60_000 };

const visitorHits = new Map<string, number[]>();
let globalHits: number[] = [];

export const publicDemoRateLimitMessage =
  "Koban has answered a lot of questions from you this hour. Try again a little later.";
export const publicDemoDailyLimitMessage =
  "Koban has reached today's question limit for the demo. Try again tomorrow.";

export type PublicDemoRateLimitResult = { allowed: true } | { allowed: false; message: string; retryAfterSeconds: number };

export function takePublicDemoQuestion(visitor: string, now = Date.now()): PublicDemoRateLimitResult {
  globalHits = globalHits.filter((at) => now - at < globalLimit.windowMs);
  if (globalHits.length >= globalLimit.max) {
    return { allowed: false, message: publicDemoDailyLimitMessage, retryAfterSeconds: retryAfter(globalHits, globalLimit.windowMs, now) };
  }

  const hits = (visitorHits.get(visitor) ?? []).filter((at) => now - at < visitorLimit.windowMs);
  if (hits.length >= visitorLimit.max) {
    visitorHits.set(visitor, hits);
    return { allowed: false, message: publicDemoRateLimitMessage, retryAfterSeconds: retryAfter(hits, visitorLimit.windowMs, now) };
  }

  hits.push(now);
  visitorHits.set(visitor, hits);
  globalHits.push(now);
  if (visitorHits.size > 5_000) pruneVisitors(now);
  return { allowed: true };
}

// Railway's edge appends the client address as the first x-forwarded-for entry.
export function publicDemoVisitorKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export function resetPublicDemoRateLimits() {
  visitorHits.clear();
  globalHits = [];
}

function retryAfter(hits: number[], windowMs: number, now: number) {
  return Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
}

function pruneVisitors(now: number) {
  for (const [visitor, hits] of visitorHits) {
    if (hits.every((at) => now - at >= visitorLimit.windowMs)) visitorHits.delete(visitor);
  }
}
